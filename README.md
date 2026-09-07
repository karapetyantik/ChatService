# ChatService

Ядро обмена сообщениями платформы **Tapik**: чаты, сообщения, realtime-доставка через WebSocket, статусы прочтения. Центральный сервис, с которым интегрируются AIAssistantService (отложенные сообщения), ReactionsService (реакции), MediaService (вложения) и NotificationService (push).

## Роль в системе

```
                    HTTP (JWT)                  WebSocket (JWT в handshake)
Клиент ─────────────────────────▶┐        ┌────────────────────────────▶┐
                                   │        │                             │
                              ┌────▼────────▼────┐         Redis adapter  │
                              │    ChatService     │◀───(multi-instance)──┘
                              └──┬───────┬───────┬─┘
             gRPC (x-internal-key)│      │RabbitMQ│ gRPC-клиент (x-internal-key)
        ┌──────────────────────┘        │        └───────────────────┐
        ▼                                ▼                            ▼
AIAssistantService,               NotificationService,          MediaService
ReactionsService                  ReactionsService (delivery)   (проверка вложений)
(входящие: GetChatMembers,
 IsMember, SendMessageInternal)
```

Хранилище сообщений — **ScyllaDB/Cassandra** (не PostgreSQL/Prisma, в отличие от большинства других сервисов платформы), рассчитанное на высокий write-throughput чата.

## Технологии

- **NestJS 11**, гибридное приложение: HTTP + WebSocket (Socket.IO) + gRPC-сервер + gRPC-клиент + RabbitMQ (producer и consumer)
- **ScyllaDB/Cassandra** (`cassandra-driver`) — чаты, участники, сообщения, read-состояние
- **Redis** — presence (`user_sockets:{userId}` → socket-id), Socket.IO Redis-adapter для горизонтального масштабирования гейтвея
- **RabbitMQ** — publisher (`message.sent`, `chat.read`) и proxy-получатель `message.reaction` от ReactionsService для доставки в сокеты
- **gRPC** (`@grpc/grpc-js`) — сервер `ChatInternal` (для AIAssistantService, ReactionsService) и клиент к `MediaInternal` (MediaService)
- Path-алиасы: `@common/*`, `@modules/*`, `@proto/*`

## Возможности

- Личные и групповые чаты, роли участников (`admin`/`member`), добавление/удаление участников.
- Отправка сообщений с текстом и/или вложениями (вложения верифицируются в MediaService по gRPC перед сохранением, параллельно для всех вложений).
- Realtime-доставка новых сообщений, реакций и статусов прочтения через WebSocket всем активным сокетам получателя (с учётом множества вкладок/устройств через Redis-adapter).
- Статусы прочтения (`chat.read`) с уведомлением остальных участников.
- Внутренний gRPC-сервер `ChatInternal` — используется AIAssistantService (отложенная отправка, проверка членства) и ReactionsService (получатели для рассылки реакции), защищён shared-secret заголовком.

## HTTP API (`/chats`)

Все эндпоинты требуют `JwtAuthGuard`.

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/chats` | Создать чат (`direct` — ровно 1 собеседник, или `group`) |
| `GET` | `/chats` | Список чатов текущего пользователя |
| `POST` | `/chats/:chatId/members` | Добавить участников (только админ группы) |
| `DELETE` | `/chats/:chatId/members/:userId` | Удалить участника (только админ) |
| `POST` | `/chats/:chatId/read` | Отметить сообщение прочитанным |
| `POST` | `/chats/messages` | Отправить сообщение |
| `GET` | `/chats/:chatId/messages` | История сообщений (`?limit=50`) |

## WebSocket (`/`, Socket.IO)

- Аутентификация в `handshake.auth.token` или заголовке `Authorization: Bearer` — JWT проверяется в `handleConnection`, невалидный токен обрывает соединение.
- CORS ограничен `FRONTEND_URL`.
- События, которые сервер шлёт клиенту: `message`, `reaction`, `read`.
- Клиент ничего не подписывает через `@SubscribeMessage` — доставка идёт по факту наличия открытого сокета у получателя (`user_sockets:{userId}` в Redis), не по комнатам.

## Внутренний gRPC-сервер: `ChatInternal`

Proto: `src/proto/chat.proto`. Защищён `InternalGrpcAuthGuard` — каждый вызов обязан нести metadata `x-internal-key`, совпадающий с `INTERNAL_API_KEY`.

| RPC | Вызывается кем | Назначение |
|---|---|---|
| `GetChatMembers` | ReactionsService | Список участников чата (для рассылки реакции) |
| `IsMember` | AIAssistantService, ReactionsService | Проверка членства перед действием |
| `SendMessageInternal` | AIAssistantService | Отправка отложенного сообщения от имени пользователя |

## RabbitMQ

**Публикует:**

| Событие | Очередь-получатель | Когда |
|---|---|---|
| `message.sent` | `chat_events` (себе же, для доставки) + `notification_events` | Новое сообщение отправлено |
| `chat.read` | `chat_events` | Сообщение отмечено прочитанным |

**Потребляет** (`chat_events`, для WebSocket-доставки): `message.sent`, `chat.read`, а также `message.reaction` (публикуется ReactionsService).

## Переменные окружения

| Переменная | Обязательна | Назначение |
|---|---|---|
| `PORT` | нет (3002) | HTTP-порт |
| `JWT_SECRET` | да | Проверка JWT (HTTP и WebSocket) |
| `SCYLLA_CONTACT_POINT` / `SCYLLA_PORT` / `SCYLLA_KEYSPACE` | да | Подключение к ScyllaDB/Cassandra |
| `RABBITMQ_URL` | да | AMQP |
| `REDIS_HOST` / `REDIS_PORT` | да | Presence + Socket.IO adapter |
| `MEDIA_SERVICE_GRPC_URL` | да | Адрес gRPC MediaService (проверка вложений) |
| `INTERNAL_API_KEY` | да | Shared-secret для входящих и исходящих внутренних gRPC-вызовов |
| `FRONTEND_URL` | нет (`http://localhost:5173`) | Разрешённый origin для WebSocket CORS |

## Структура проекта

```
src/
├── main.ts                    # HTTP + WS + gRPC(:5001) + RMQ bootstrap
├── common/
│   ├── auth/                  # JwtStrategy, JwtAuthGuard, AuthenticatedRequest
│   ├── cassandra/             # CassandraService
│   └── redis/                 # RedisService
├── modules/
│   ├── chats/                 # ChatsController/Service, dto/create-chat, add-members
│   ├── messages/               # MessagesController/Service, dto/send-message
│   ├── gateway/
│   │   ├── chat.gateway.ts    # WebSocket auth + presence
│   │   ├── delivery/          # EventPattern → emit в сокеты
│   │   └── adapters/          # RedisIoAdapter (multi-instance)
│   ├── grpc-internal/         # ChatInternal сервер + InternalGrpcAuthGuard
│   └── media-client/          # gRPC-клиент к MediaService
└── proto/
    └── chat.proto
```

## Запуск

```bash
npm install

npm run start:dev
npm run build && npm run start:prod
npm run test
npm run lint
```

Требует поднятый ScyllaDB/Cassandra keyspace (схема применяется вне этого репозитория, миграций Prisma здесь нет), Redis и RabbitMQ.

## Безопасность

- Внутренний gRPC-сервер (`ChatInternal`) требует shared-secret — раньше был полностью открыт в сети.
- WebSocket-подключение без валидного JWT немедленно разрывается.
- CORS WebSocket ограничен конкретным origin, а не `*`.
- N+1-вызовы к MediaService при отправке нескольких вложений выполняются параллельно (`Promise.all`), а не последовательно.
