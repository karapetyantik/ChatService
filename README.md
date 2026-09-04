# ChatService — подробная документация (все файлы)

Ядро системы обмена сообщениями: чаты, участники, сообщения, история, доставка в реальном времени по WebSocket, gRPC-контракт для других сервисов. Хранилище — ScyllaDB/Cassandra. Реальный самый «многосоставной» сервис в системе: HTTP REST, WebSocket Gateway, gRPC-сервер (для `ReactionsService`), gRPC-клиент (к `MediaService`), RabbitMQ publisher и consumer одновременно.

---

## 1. Дерево модуля

```
src/
├── main.ts
├── app.module.ts / app.controller.ts / app.service.ts
├── common/
│   ├── auth/       (jwt.strategy.ts, jwt-auth.guard.ts, auth.module.ts)
│   ├── cassandra/  (cassandra.module.ts, cassandra.service.ts)
│   └── redis/      (redis.module.ts, redis.service.ts)
├── proto/
│   ├── chat.proto   — контракт ChatInternal (сервер здесь)
│   └── media.proto  — контракт MediaInternal (клиент здесь)
└── modules/
    ├── chats/
    │   ├── chats.module.ts / chats.controller.ts / chats.service.ts
    │   ├── dto/ (creat-chat.dto.ts, add-members.dto.ts)
    │   └── grpc-chat/grpc-chat.controller.ts
    ├── messages/
    │   ├── messages.module.ts / messages.controller.ts / messages.service.ts
    │   └── dto/send-message.dto.ts
    ├── media-client/
    │   ├── media-client.module.ts
    │   └── media-client.service.ts     — gRPC-клиент к MediaService
    └── gateway/
        ├── gateway.module.ts / chat.gateway.ts / gateway.service.ts
        ├── adapters/redis-io.adapter.ts
        └── delivery/delivery.controller.ts
```

---

## 2. `main.ts` — точка входа (самая насыщенная среди всех сервисов)

Поднимает сразу **четыре** транспорта:

1. **HTTP** — обычный REST через `NestFactory.create`, `ValidationPipe` глобально.
2. **WebSocket (Socket.IO) с Redis-адаптером** — создаётся `RedisIoAdapter`, вызывается `connectToRedis(REDIS_HOST, REDIS_PORT)`, затем `app.useWebSocketAdapter(redisIoAdapter)`. Redis здесь служит **pub/sub шиной между инстансами** Socket.IO — если сервис масштабирован на несколько подов, событие, отправленное одним инстансом, долетит до сокетов, подключённых к другому инстансу.
3. **RabbitMQ-консьюмер**: `Transport.RMQ`, очередь `chat_events` (durable) — сервис слушает события `message.sent`, `message.reaction`, `chat.read` (все они, в том числе, публикуются им же самим — см. ниже) для доставки через WebSocket.
4. **gRPC-сервер**: `Transport.GRPC`, `package: 'chat'`, `protoPath: chat.proto`, слушает `0.0.0.0:5001` — это то, к чему обращается `ReactionsService` через `ChatsClientService`.

Порт HTTP — `PORT`, по умолчанию `3002`.

## 3. `app.module.ts`

Импортирует: `ConfigModule` (global), `CassandraModule`, `AuthModule`, `MessagesModule`, `ChatsModule`, `RedisModule`, `GatewayModule`, `MediaClientModule`. Отдельно регистрирует `GrpcChatController` на уровне **корневого** модуля приложения (`controllers: [AppController, GrpcChatController]`) — при этом тот же `GrpcChatController` уже зарегистрирован и внутри `ChatsModule` (см. раздел 8, замечания) — потенциальное дублирование регистрации контроллера.

## 4. `common/auth/`, `common/redis/`

Идентичны по коду соответствующим модулям в других сервисах (общий `JWT_SECRET`, тот же `ioredis`-обёртка).

## 5. `common/cassandra/` — `CassandraService`, `CassandraModule`

- Подключается к ScyllaDB/Cassandra через `cassandra-driver`: `contactPoints: [SCYLLA_CONTACT_POINT]`, `localDataCenter: 'datacenter1'` (захардкожено), `keyspace: SCYLLA_KEYSPACE`, порт — `SCYLLA_PORT` (по умолчанию `9042`).
- `onModuleInit` → `client.connect()`; `onModuleDestroy` → `client.shutdown()`.
- `client` — публичное свойство, используется напрямую (`chatsService`/`messagesService` формируют «сырые» CQL-запросы через `cassandra.client.execute`/`batch`).

## 6. `modules/media-client/` — gRPC-клиент к `MediaService` (новый по сравнению с ранее задокументированным)

- `MediaClientModule` регистрирует `ClientsModule` под именем `MEDIA_GRPC_SERVICE`, транспорт `GRPC`, `package: 'media'`, `protoPath: dist/proto/media.proto` (обратите внимание — путь на **скомпилированный** `dist`, а не `src`, то есть proto-файл копируется в `dist` при сборке), `url: MEDIA_SERVICE_GRPC_URL`.
- `MediaClientService.verifyMedia(mediaId, uploaderId)` — вызывает удалённый метод `MediaInternal.VerifyMedia` (описанный в `media.proto`), оборачивая `Observable` в `Promise` через `firstValueFrom`. Возвращает `{ valid, url, mimeType, placeholder }`.
- Используется `MessagesService` для проверки, что вложения к сообщению существуют и принадлежат отправителю, прежде чем считать сообщение отправленным (см. раздел 12).

## 7. `proto/chat.proto`, `proto/media.proto`

- `chat.proto` — контракт `ChatInternal` (`GetChatMembers`, `IsMember`) — **сервер** этого контракта реализован здесь же (`GrpcChatController`), клиент — в `ReactionsService`.
- `media.proto` — контракт `MediaInternal` (`VerifyMedia`) — **клиент** этого контракта здесь (`MediaClientService`), сервер — в `MediaService`.

---

## 8. `modules/chats/` — управление чатами

### 8.1. `chats.module.ts`
Импортирует `CassandraModule`, регистрирует `ClientsModule` (`RABBITMQ_SERVICE`, очередь `chat_events`). Controllers: `ChatsController`, `GrpcChatController`. Providers: `ChatsService`, `GrpcChatController`.

**Замечание:** `GrpcChatController` перечислен и в `controllers`, и в `providers` **этого** модуля, а также отдельно зарегистрирован в `controllers` корневого `AppModule` — это тройное упоминание одного класса в конфигурации DI избыточно и потенциально указывает на неаккуратный рефакторинг (изначально, вероятно, gRPC-контроллер регистрировался прямо в `AppModule`, затем был перенесён в `ChatsModule`, но старая регистрация не была убрана).

### 8.2. DTO — `CreateChatDto`, `AddMembersDto`
Без изменений относительно ранее задокументированной версии: `type` (`direct`/`group`), `title` (опционально, до 100 симв.), `memberIds` (массив UUID v4, минимум 1 элемент).

### 8.3. `chats.controller.ts` — REST `/chats/*`
Без изменений: `POST /chats`, `GET /chats`, `POST /:chatId/members`, `DELETE /:chatId/members/:userId`, `POST /:chatId/read`. Весь контроллер под `JwtAuthGuard`.

### 8.4. `chats.service.ts` — бизнес-логика
Идентична ранее задокументированной версии: `createChat`, `getUserChats`, `isMember`, `assertMember`, `getMemberRole`, `assertAdmin`, `getChat`, `addMembers`, `removeMember`, `getMemberIds`, `markAsRead`, `getReadState`. Полное описание методов, модели данных (`chats`, `chat_members`, `user_chats`, `chat_read_state`) и найденных проблем — см. документ «ChatsService» (создание дублей `direct`-чатов, `removeMember` не проверяет тип/существование чата, `addMembers`/`removeMember` не публикуют события и т.д.) — все замечания остаются в силе.

### 8.5. `grpc-chat/grpc-chat.controller.ts` — сервер `ChatInternal`
Без изменений: `GetChatMembers` → `getMemberIds`, `IsMember` → `isMember`. Не проверяет существование чата (несуществующий `chatId` тихо даёт `isMember: false` / пустой `memberIds`).

---

## 9. `modules/messages/` — отправка и история сообщений (не документировался ранее отдельно)

### 9.1. `dto/send-message.dto.ts`

```ts
class AttachmentDto {
  @IsUUID() mediaId!: string;
  @IsUrl() url!: string;
  @IsIn(['image', 'file', 'gif', 'video']) type!: string;
  @IsOptional() @IsString() fileName?: string;
  @IsOptional() @IsInt() sizeBytes?: number;
  @IsOptional() placeholder?: string;
}

class SendMessageDto {
  @IsUUID() chatId!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(4000) content?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AttachmentDto) attachments?: AttachmentDto[];
}
```

- `content` опционален (сообщение может состоять только из вложений).
- `AttachmentDto.url` должен быть валидным URL **на входе** — однако в `messages.service.ts` (см. ниже) это поле **перезаписывается** результатом `verifyMedia` перед сохранением, то есть присланный клиентом `url` фактически используется только для прохождения валидации DTO и тут же отбрасывается.
- `placeholder` в DTO не типизирован и не валидируется (`@IsOptional() placeholder?: string` без явного `@IsString()`), что означает `class-validator` его вообще не проверяет — фактически поле принимает что угодно, включая типы, отличные от строки, если `forbidNonWhitelisted` его не отсеет (поле присутствует в классе, поэтому не отсеивается).

### 9.2. `messages.module.ts`
Импортирует `MediaClientModule`, `CassandraModule`, `ChatsModule` (для использования `ChatsService.assertMember`/`getMemberIds` напрямую как провайдера), регистрирует `RABBITMQ_SERVICE` (очередь `chat_events`). Providers: `MessagesService`. Controllers: `MessagesController`.

### 9.3. `messages.controller.ts` — REST

| Метод | HTTP | Роут | Guard |
|---|---|---|---|
| `send` | POST | `/chats/messages` | `JwtAuthGuard` |
| `history` | GET | `/chats/:chatId/messages` | `JwtAuthGuard` |

**Замечание по роутингу:** контроллер зарегистрирован как `@Controller('chats')`, а метод `send` — `@Post('messages')`, что вместе даёт путь `POST /chats/messages` (а не, например, `POST /chats/:chatId/messages`, как можно было бы ожидать по аналогии с `history`). `chatId` для отправки передаётся не в URL, а в теле (`dto.chatId`) — асимметрия по сравнению с чтением истории, где `chatId` — параметр пути. Не баг, но неконсистентный дизайн API.

`history`: `limit` — необязательный query-параметр, парсится через `parseInt(limit, 10)` без проверки на `NaN` или отрицательные значения — если передать `limit=abc`, `parseInt` вернёт `NaN`, что уйдёт в CQL-запрос `LIMIT ?` и, вероятнее всего, приведёт к ошибке на уровне драйвера Cassandra, а не к контролируемой `400 Bad Request`.

### 9.4. `messages.service.ts` — бизнес-логика

**Зависимости:** `MediaClientService`, `CassandraService`, `ChatsService`, `ClientProxy('RABBITMQ_SERVICE')`.

#### `sendMessage(senderId, dto)`
1. Требует хотя бы `content` **или** непустой `attachments` — иначе `BadRequestException`.
2. `chatsService.assertMember(dto.chatId, senderId)` — проверка членства (межмодульный вызов сервиса напрямую, не по сети, так как `ChatsModule` импортирован как обычный Nest-модуль).
3. Генерирует `messageId` через `types.TimeUuid.now()` (Cassandra TimeUUID — сортируемый по времени идентификатор, удобен для истории по возрастанию/убыванию времени).
4. Определяет `type` сообщения: `'text'`, если вложений нет; `'mixed'`, если есть и текст, и вложения; иначе — тип первого вложения (`image`/`file`/`gif`/`video`) — то есть при нескольких разнотипных вложениях **без текста** тип сообщения определяется по **первому** вложению, а не отражает смешанный состав (см. замечания).
5. Если есть вложения — для **каждого** вызывает `mediaClient.verifyMedia(attachment.mediaId, senderId)` (gRPC к `MediaService`). Если `!verified.valid` — `BadRequestException('Вложение {mediaId} не найдено или не принадлежит вам')`. При успехе — **перезаписывает** `attachment.url` и `attachment.placeholder` результатом от `MediaService` (то есть URL, присланный клиентом в DTO, полностью игнорируется — используется только для прохождения `@IsUrl()`-валидации, значения не имеющей смысловой роли далее).
6. Вставляет запись в `messages` (Cassandra): `chat_id`, `message_id`, `sender_id`, `content`, `created_at`, `type`, `attachments` (массив вложенных UDT/map-структур с полями `media_id`, `url`, `type`, `file_name`, `size_bytes`, `placeholder`).
7. Получает список участников чата (`chatsService.getMemberIds`) и публикует `rabbitClient.emit('message.sent', { chatId, messageId, senderId, content, attachments, type, createdAt, recipientIds })`.
8. Возвращает объект сообщения клиенту.

**Замечание (производительность):** проверка вложений выполняется **последовательно** в цикле `for...of` с `await` внутри — при нескольких вложениях каждое ждёт отдельный gRPC round-trip по очереди, а не параллельно (`Promise.all`), что увеличивает время ответа пропорционально числу вложений.

**Замечание (консистентность):** если сообщение содержит несколько вложений и одно из них не проходит `verifyMedia` (например, третье из пяти), исключение выбрасывается **после** того, как предыдущие вложения уже были «верифицированы» (по сути, ничего не изменено в БД до этого момента — `INSERT` происходит только после цикла, так что в этом смысле откатывать нечего, операция атомарна по отношению к записи в Cassandra). Но сама проверка не транзакционна на уровне `MediaService` — если между проверкой и `INSERT` файл окажется удалён/испорчен, это не будет обнаружено повторно.

#### `getHistory(chatId, userId, limit = 50)`
Проверка членства (`assertMember`) → `SELECT * FROM messages WHERE chat_id = ? LIMIT ?`. Простая постраничность через `LIMIT` без курсора/пагинации по времени — при большом объёме сообщений в чате нельзя получить «следующую страницу» отдельно от первых `limit` записей (нет `paging state`/`WHERE message_id < ?`), то есть **пагинация как таковая не реализована**, доступен только «верхний срез» из `limit` сообщений.

---

## 10. `modules/gateway/` — доставка в реальном времени (WebSocket)

### 10.1. `adapters/redis-io.adapter.ts`

- `RedisIoAdapter extends IoAdapter` — переопределяет `createIOServer`, подключая `@socket.io/redis-adapter` поверх пары клиентов `ioredis` (`pubClient`/`subClient = pubClient.duplicate()`).
- Цель — горизонтальное масштабирование Socket.IO: без этого адаптера сообщение, отправленное конкретному `socketId`, было бы видно только тому инстансу Node.js, к которому этот сокет физически подключён.

### 10.2. `chat.gateway.ts` — `ChatGateway`

- `@WebSocketGateway({ cors: { origin: '*' } })` — CORS открыт для всех источников (см. замечания — в проде обычно сужают до конкретных доменов).
- `handleConnection(client)`:
  1. Достаёт JWT либо из `client.handshake.auth.token`, либо из заголовка `Authorization` (`Bearer ...`).
  2. Верифицирует токен через `jwtService.verifyAsync` (тот же `JWT_SECRET`, что и HTTP-guard, — общий на всю систему).
  3. При успехе — сохраняет `userId` в `client.data.userId`, добавляет `client.id` в Redis-множество `` `user_sockets:${userId}` `` (`SADD`) — так поддерживается связь «пользователь → все его активные сокеты» (несколько вкладок/устройств).
  4. При ошибке — логирует предупреждение и обрывает соединение (`client.disconnect()`).
- `handleDisconnect(client)` — убирает `client.id` из того же множества (`SREM`).

**Замечание:** множество `user_sockets:{userId}` в Redis не имеет TTL — при аварийном обрыве соединения без штатного `disconnect`-события (например, при падении процесса Node.js) «осиротевшие» `socketId` могут накапливаться в множестве бессрочно, если Socket.IO/Redis-адаптер не гарантируют вызов `handleDisconnect` в 100% случаев сбоев.

### 10.3. `delivery/delivery.controller.ts` — `DeliveryController`

Слушает **все три** события из очереди `chat_events` и раздаёт их подключённым сокетам через Redis-множества `user_sockets:{userId}`:

| Событие | Кому рассылается | Имя WS-события клиенту |
|---|---|---|
| `message.sent` | всем `recipientIds` | `'message'` |
| `message.reaction` | всем `recipientIds` | `'reaction'` |
| `chat.read` | всем `recipientIds`, **кроме** самого `event.userId` (кто отметил прочтение) | `'read'` |

Для каждого получателя — `SMEMBERS user_sockets:{userId}` → `server.to(socketId).emit(eventName, event)` по каждому активному сокету. Если пользователь оффлайн (нет сокетов) — событие просто теряется для него (никакого fallback на push-уведомления/офлайн-очередь в этом коде не предусмотрено).

**Замечание:** `handleMessageReaction` — приходит из `ReactionsService` (`message.reaction` в очередь `chat_events`), то есть очередь `chat_events` — это **общая шина** для событий сразу от `ChatService` (`message.sent`, `chat.read`) и от `ReactionsService` (`message.reaction`); оба сервиса пишут в одну и ту же durable-очередь, из которой читает только `DeliveryController` в `ChatService`.

### 10.4. `gateway.module.ts`

Импортирует `RedisModule`, регистрирует `JwtModule.registerAsync` **только с секретом** (`{ secret: JWT_SECRET }`, без `signOptions`) — этот `JwtModule` используется исключительно для **верификации** входящих WS-токенов (`jwtService.verifyAsync`), не для выпуска новых. Providers: `ChatGateway`. Controllers: `DeliveryController`.

### 10.5. `gateway.service.ts`
Пустой класс-заглушка (`@Injectable() export class GatewayService {}`), не содержит логики и, судя по всему, не инжектируется нигде — вероятно, остаток от шаблона генерации модуля (`nest g module`), который не был удалён.

---

## 11. Модель данных Cassandra (сводно по всему сервису)

| Таблица | Ключевые поля | Заполняется в |
|---|---|---|
| `chats` | `chat_id` (PK) | `ChatsService.createChat` |
| `chat_members` | `chat_id` + `user_id` | `ChatsService.createChat` / `addMembers` / `removeMember` |
| `user_chats` | `user_id` + `chat_id` | те же методы (обратный индекс) |
| `chat_read_state` | `user_id` + `chat_id` | `ChatsService.markAsRead` |
| `messages` | `chat_id` + `message_id` (TimeUUID) | `MessagesService.sendMessage` |

---

## 12. Интеграции — сводная таблица

| Канал | Направление | Партнёр | Что передаётся |
|---|---|---|---|
| RabbitMQ (`chat_events`) | публикует | — | `message.sent`, `chat.read` |
| RabbitMQ (`chat_events`) | публикует | `ReactionsService` (внешний источник) | `message.reaction` — этот сервис лишь слушает, не публикует его сам |
| RabbitMQ (`chat_events`) | слушает | сам себя + `ReactionsService` | `message.sent`, `message.reaction`, `chat.read` → раздача по WebSocket |
| gRPC-сервер (`ChatInternal`, порт 5001) | предоставляет | `ReactionsService` | `GetChatMembers`, `IsMember` |
| gRPC-клиент (`MediaInternal`) | вызывает | `MediaService` | `VerifyMedia` — проверка вложений при отправке сообщения |
| WebSocket (Socket.IO + Redis adapter) | сервер | клиентские приложения | доставка `message`/`reaction`/`read` в реальном времени |

---

## 13. Сводные замечания по всему сервису

1. **`GrpcChatController` регистрируется трижды** (в `controllers` и `providers` `ChatsModule`, и ещё раз в `controllers` корневого `AppModule`) — избыточно, стоит оставить одну точку регистрации.
2. **Асимметричный роутинг сообщений**: `POST /chats/messages` (тело содержит `chatId`) против `GET /chats/:chatId/messages` (параметр пути) — неконсистентный дизайн REST API.
3. **`limit` в `history` не валидируется** — некорректное значение уйдёт напрямую в CQL-запрос вместо контролируемой ошибки `400`.
4. **История сообщений не поддерживает постраничную навигацию** — только «верхний срез» из `limit` записей, без курсора.
5. **`AttachmentDto.url`, присланный клиентом, отбрасывается и заменяется результатом `verifyMedia`** — само поле в DTO валидируется, но семантически избыточно (клиент не может повлиять на итоговый URL, что корректно с точки зрения безопасности, но означает, что `@IsUrl()` в DTO проверяет фактически «мусорное» значение).
6. **Вложения проверяются последовательно, а не параллельно** — потенциальная просадка производительности при отправке сообщений с несколькими вложениями.
7. **CORS у WebSocket-шлюза открыт на `*`** — стоит сузить в проде.
8. **`user_sockets:{userId}` в Redis не имеет TTL** — риск накопления «мёртвых» `socketId` при нештатных обрывах соединения.
9. **`gateway.service.ts` — неиспользуемый пустой файл**, вероятно, наследие генератора модулей.
10. Все замечания из документа «ChatsService» по логике `chats.service.ts` (дублирование `direct`-чатов, `removeMember` без проверки типа чата, отсутствие событий при добавлении/удалении участников и т.д.) остаются в силе.
