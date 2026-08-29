# ChatsService — документация

Сервис управления чатами (личными и групповыми): создание чатов, управление участниками, отметки о прочтении сообщений и предоставление данных о членстве другим микросервисам по gRPC. Является ядром микросервиса `Chat`, к которому по gRPC обращаются другие сервисы (например, `ReactionsService` из микросервиса реакций — см. документацию `ReactionsService`).

---

## 1. Общее описание

Модуль `ChatsModule` объединяет:

- **`ChatsController`** — REST-эндпоинты `/chats/*` для клиентских приложений;
- **`GrpcChatController`** — внутренний gRPC-контроллер (`ChatInternal`), реализующий контракт из `chat.proto` для других микросервисов;
- **`ChatsService`** — вся бизнес-логика, общая для обоих контроллеров.

### 1.1. Зависимости `ChatsService`

| Зависимость | Назначение |
|---|---|
| `CassandraService` | Хранилище данных о чатах, участниках и статусах прочтения |
| `ClientProxy` (`RABBITMQ_SERVICE`) | Публикация события `chat.read` при отметке сообщений прочитанными |

### 1.2. Модель данных (таблицы Cassandra, судя по запросам)

Явной схемы (`CREATE TABLE`) в предоставленном коде нет, но по CQL-запросам можно восстановить структуру:

| Таблица | Ключевые поля (предположительно) | Назначение |
|---|---|---|
| `chats` | `chat_id` (PK) | Метаданные чата: `type`, `title`, `created_by`, `created_at` |
| `chat_members` | `chat_id` + `user_id` (составной PK) | Участники чата и их роль (`role`), дата вступления (`joined_at`) |
| `user_chats` | `user_id` + `chat_id` (составной PK) | Обратный индекс: список чатов пользователя (денормализация для быстрого `getUserChats`) |
| `chat_read_state` | `user_id` + `chat_id` (составной PK) | Последнее прочитанное сообщение пользователя в чате (`last_read_message_id`, `updated_at`) |

Таблицы `chat_members` и `user_chats` — классический для Cassandra паттерн денормализации «две таблицы под два разных паттерна доступа» (по чату → участники; по пользователю → чаты), так как Cassandra не поддерживает произвольные `JOIN`.

---

## 2. `ChatsController` (REST)

Весь контроллер защищён `@UseGuards(JwtAuthGuard)`.

### 2.1. `POST /chats` — `create(req, dto)`
→ `createChat(req.user.userId, dto)`. Создатель чата определяется из JWT, а не из тела запроса.

### 2.2. `GET /chats` — `myChats(req)`
→ `getUserChats(req.user.userId)`. Возвращает список чатов текущего пользователя.

### 2.3. `POST /chats/:chatId/members` — `addMembers(req, chatId, dto)`
→ `addMembers(chatId, req.user.userId, dto.memberIds)`. Добавление участников в групповой чат (только администратором).

### 2.4. `DELETE /chats/:chatId/members/:userId` — `removeMember(req, chatId, userId)`
→ `removeMember(chatId, req.user.userId, userId)`. Удаление участника (только администратором, не для самого себя).

### 2.5. `POST /chats/:chatId/read` — `markAsRead(req, chatId, messageId)`
→ `markAsRead(chatId, req.user.userId, messageId)`. `messageId` читается напрямую из тела запроса (`@Body('messageId')`), без DTO и без валидации формата.

---

## 3. `GrpcChatController` (внутренний gRPC-контракт)

Реализует сервис `ChatInternal` из `chat.proto`, вызываемый **другими** микросервисами (например, `Reactions`) напрямую, в обход HTTP и без `JwtAuthGuard` — доверие обеспечивается тем, что gRPC-эндпоинт доступен только внутри приватной сети микросервисов.

```proto
service ChatInternal {
  rpc GetChatMembers (ChatIdRequest) returns (MembersResponse);
  rpc IsMember (MembershipRequest) returns (MembershipResponse);
}
```

| gRPC-метод | Делегирует в | Возвращает |
|---|---|---|
| `GetChatMembers({ chatId })` | `chatsService.getMemberIds(chatId)` | `{ memberIds: string[] }` |
| `IsMember({ chatId, userId })` | `chatsService.isMember(chatId, userId)` | `{ isMember: boolean }` |

**Важно:** ни `getMemberIds`, ни `isMember` не проверяют, существует ли вообще чат с таким `chatId` — при несуществующем `chatId` `isMember` просто вернёт `false` (пустой результат SELECT), а `getMemberIds` — пустой массив, без ошибки `NotFoundException`.

---

## 4. `ChatsService` — методы

### 4.1. `createChat(creatorId, dto: CreateChatDto)`

Создаёт новый чат (личный или групповой).

**Логика:**
1. Если `dto.type === 'direct'`, требует ровно одного собеседника в `memberIds` — иначе `BadRequestException`.
2. Генерирует `chatId` (`types.Uuid.random()` из `cassandra-driver`).
3. Формирует список участников: создатель получает роль `admin`, остальные (после дедупликации через `Set` и исключения самого создателя, если он случайно передан в `memberIds`) — роль `member`.
4. Вставляет запись в `chats` (`chat_id`, `type`, `title`, `created_by`, `created_at`).
5. Батчем (`cassandra.client.batch`) вставляет по две записи на каждого участника: в `chat_members` (участники конкретного чата) и в `user_chats` (обратный индекс «чаты пользователя»).
6. Возвращает объект с `chatId` (строкой), `creatorId`, `type`, `title` и полным списком `members` (с ролями).

**Исключения:**
- `BadRequestException` — личный чат с числом собеседников ≠ 1.

**Замечание:** для `type: 'direct'` сервис не проверяет, не существует ли уже личный чат между этими двумя пользователями — при повторном вызове будет создан **новый** дублирующий личный чат.

### 4.2. `getUserChats(userId)`

`SELECT * FROM user_chats WHERE user_id = ?` — возвращает «сырые» строки денормализованной таблицы (`chat_id`, `joined_at` и то, что ещё в ней хранится), **без** метаданных чата (без `title`, `type` и т.д.) — клиенту, скорее всего, потребуется дополнительный запрос `getChat` на каждый `chat_id`, если нужны подробности (N+1-паттерн, если он не решается отдельно на фронтенде/агрегирующем слое).

### 4.3. `isMember(chatId, userId): Promise<boolean>`

`SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id = ?` → `true`, если найдена хотя бы одна строка. Базовая проверка членства, используется как внутри REST-методов, так и через gRPC.

### 4.4. `assertMember(chatId, userId): Promise<void>`

Обёртка над `isMember`, бросающая `ForbiddenException('Вы не состоите в этом чате')`, если пользователь не участник. Используется в `markAsRead`.

### 4.5. `getMemberRole(chatId, userId): Promise<string | null>`

`SELECT role FROM chat_members ...` — возвращает роль (`admin`/`member`) или `null`, если пользователь не состоит в чате.

### 4.6. `assertAdmin(chatId, userId): Promise<void>`

Через `getMemberRole` проверяет, что роль пользователя — `admin`, иначе `ForbiddenException('Только администратор группы может выполнить это действие')`. Используется в `addMembers` и `removeMember`.

**Замечание:** если пользователь вообще не состоит в чате, `getMemberRole` вернёт `null`, что тоже не равно `'admin'` — в этом случае `assertAdmin` корректно выбросит `ForbiddenException`, но с формулировкой «только администратор», хотя точнее было бы отдельное сообщение «вы не состоите в чате».

### 4.7. `getChat(chatId)`

`SELECT * FROM chats WHERE chat_id = ?`. Если строка не найдена — `NotFoundException('Чат не найден')`. Возвращает единственную найденную строку (`result.first()`).

### 4.8. `addMembers(chatId, requesterId, newMemberIds)`

Добавление новых участников в **групповой** чат.

**Логика:**
1. Загружает чат (`getChat`) — если не найден, всплывает `NotFoundException` из `getChat`.
2. Проверяет `chat.type === 'group'` — иначе `BadRequestException('Добавлять участников можно только в групповой чат')` (в личный чат нельзя добавлять третьих лиц).
3. Проверяет, что `requesterId` — админ чата (`assertAdmin`).
4. Дедуплицирует `newMemberIds` и исключает самого `requesterId` из списка.
5. Если после этого список пуст — `BadRequestException('Нет новых участников для добавления')`.
6. Параллельно (`Promise.all`) проверяет, кто из указанных пользователей уже состоит в чате, и оставляет только тех, кто ещё не состоит.
7. Если добавлять некого (все уже участники) — `ConflictException('Все указанные пользователи уже состоят в чате')`.
8. Батчем вставляет записи в `chat_members` и `user_chats` для каждого нового участника с ролью `member`.
9. Возвращает `{ chatId, addedMemberIds }`.

**Исключения:** `NotFoundException`, `BadRequestException` (дважды, по разным причинам), `ForbiddenException` (не админ), `ConflictException`.

**Замечание:** метод не публикует никакого события (в отличие от `markAsRead`) — участники не получают уведомление о своём добавлении в чат через RabbitMQ/WebSocket на уровне этого сервиса.

### 4.9. `removeMember(chatId, requesterId, targetUserId)`

Удаление участника из чата администратором.

**Логика:**
1. Проверяет, что `requesterId` — админ (`assertAdmin`). Заметьте: в отличие от `addMembers`, здесь **не проверяется существование чата и его тип** (`getChat` не вызывается) — если `chatId` не существует, `assertAdmin`/`getMemberRole` просто не найдёт роль и выбросит `ForbiddenException`, а не `NotFoundException`, что может ввести в заблуждение при отладке.
2. Запрещает удалять самого себя: `BadRequestException('Нельзя удалить самого себя таким способом — используйте выход из группы')` (при этом отдельного метода «выйти из группы» в предоставленном коде нет).
3. Проверяет, что `targetUserId` действительно состоит в чате — иначе `NotFoundException('Этот пользователь не состоит в чате')`.
4. Батчем удаляет записи из `chat_members` и `user_chats`.
5. Возвращает `{ chatId, removedUserId }`.

**Замечание:** как и `addMembers`, не публикует событие об удалении участника.

### 4.10. `getMemberIds(chatId): Promise<string[]>`

`SELECT user_id FROM chat_members WHERE chat_id = ?`, приводит каждый `user_id` к строке. Используется как внутри сервиса (`markAsRead`), так и через gRPC (`GetChatMembers`) для других микросервисов (например, чтобы `ReactionsService` знал, кому разослать уведомление о новой реакции).

### 4.11. `markAsRead(chatId, userId, messageId)`

Отмечает сообщение как прочитанное текущим пользователем.

**Логика:**
1. Проверяет членство (`assertMember`) — иначе `ForbiddenException`.
2. Записывает/обновляет `chat_read_state` (`INSERT` — в Cassandra `INSERT` с тем же ключом фактически является upsert'ом).
3. Получает список участников чата (`getMemberIds`).
4. Публикует в RabbitMQ событие `chat.read` с `{ chatId, userId, lastReadMessageId, recipientIds }` — по аналогии с `message.reaction` из `ReactionsService`, вероятно, для доставки статуса «прочитано» через WebSocket-шлюз (`gateway`-модуль).
5. Возвращает `{ chatId, lastReadMessageId }`.

**Замечание:** метод не проверяет, что `messageId` действительно существует и относится к данному чату — можно передать произвольную строку в качестве `lastReadMessageId`, и она будет сохранена без валидации (`@Body('messageId')` в контроллере тоже её не проверяет).

### 4.12. `getReadState(userId, chatId)`

`SELECT last_read_message_id, updated_at FROM chat_read_state WHERE user_id = ? AND chat_id = ?`. Возвращает найденную строку либо `null`. Не имеет собственного REST-эндпоинта в `ChatsController` — судя по всему, вызывается из другого модуля (например, `gateway` или `messages`) для расчёта статуса прочтения сообщений.

---

## 5. DTO

### 5.1. `CreateChatDto`
```ts
class CreateChatDto {
  @IsIn(['direct', 'group']) type!: 'direct' | 'group';
  @IsOptional() @IsString() @MaxLength(100) title?: string;
  @IsArray() @ArrayMinSize(1) @IsUUID('4', { each: true }) memberIds!: string[];
}
```
- `type` — ограничен строго значениями `direct`/`group`.
- `title` — опционален, до 100 символов (уместно требовать для `group`, но валидация «title обязателен для group» на уровне DTO отсутствует — это проверяется только косвенно логикой `direct` в сервисе).
- `memberIds` — минимум один элемент, каждый — UUID v4.

### 5.2. `AddMembersDto`
```ts
class AddMembersDto {
  @IsArray() @ArrayMinSize(1) @IsUUID('4', { each: true }) memberIds!: string[];
}
```
Аналогичная валидация списка добавляемых участников.

---

## 6. Используемые сообщения RabbitMQ

| Событие | Где публикуется | Payload |
|---|---|---|
| `chat.read` | `markAsRead` | `{ chatId, userId, lastReadMessageId, recipientIds }` |

Очередь: `chat_events` (durable), транспорт регистрируется через `ClientsModule.registerAsync` с `Transport.RMQ`, URL брокера — из `RABBITMQ_URL`. Та же очередь `chat_events` используется модулем `Reactions` для события `message.reaction` — оба сервиса пишут в общую очередь, из которой, вероятно, читает `gateway`-модуль для рассылки клиентам по WebSocket.

**Событий, которые сервис слушает (`@EventPattern`), в `ChatsService`/`ChatsController` нет** — в отличие от `ProfileService` (слушает `user.registered`), `ChatsModule` выступает только источником событий, а не подписчиком.

---

## 7. Замечания и потенциальные проблемы

1. **Дублирование личных чатов.** `createChat` не проверяет, существует ли уже `direct`-чат между теми же двумя пользователями — повторный вызов создаст ещё один личный чат с тем же составом участников.
2. **`removeMember` не проверяет существование и тип чата.** В отличие от `addMembers` (который сначала вызывает `getChat` и проверяет `type === 'group'`), `removeMember` полагается только на `assertAdmin`. Формально это означает, что администратор личного (`direct`) чата теоретически может «удалить участника» из личного чата, если такая роль там вообще существует, — хотя `createChat` не позволяет добавлять третьих лиц в `direct`, инвариант не проверяется на уровне `removeMember` явно.
3. **`addMembers`/`removeMember` не публикуют события.** Другие модули (WebSocket-шлюз, уведомления) не узнают об изменении состава участников в реальном времени, если только не опрашивают REST API. Для согласованности с `markAsRead`/реакциями стоило бы эмитить, например, `chat.members.added` / `chat.members.removed`.
4. **`markAsRead` не валидирует `messageId`.** Ни DTO, ни сервис не проверяют, что переданный `messageId` — существующее сообщение в этом чате; отметка о прочтении может быть создана с произвольным значением.
5. **`GrpcChatController` перечислен и в `controllers`, и в `providers` модуля.** Обычно контроллеры не добавляются в `providers` — в NestJS controllers инстанцируются отдельно через собственный механизм DI, и добавление класса-контроллера в `providers` избыточно (а в общем случае может привести к путанице или дублированию инстанцирования, в зависимости от того, инжектируется ли `GrpcChatController` где-то ещё как провайдер). Стоит убрать его из `providers`, оставив только в `controllers`.
6. **gRPC-методы (`isMember`, `getMemberIds`) не проверяют существование чата.** Для несуществующего `chatId` `IsMember` тихо вернёт `false`, а `GetChatMembers` — пустой список, вместо явной ошибки. Для внутреннего сервис-to-сервис контракта это может маскировать баги в вызывающей стороне (например, `ReactionsService` получит `isMember: false` для опечатанного `chatId` и просто ответит `403`, вместо диагностируемой ошибки «чат не найден»).
7. **Единообразие с `ReactionsService`:** здесь, в отличие от `ReactionsService.removeReaction`, отсутствует хоть какая-то защита от повторных быстрых кликов (rate-limit/lock через Redis) для операций типа `addMembers`/`removeMember`/`markAsRead` — но для этих операций дублирование обычно менее критично (создание дублирующей записи в Cassandra через `INSERT`/повторный upsert идемпотентно на уровне БД), так что это не обязательно недостаток.
8. **Сообщения об ошибках захардкожены на русском** — согласуется с остальными сервисами системы (`AuthService`, `ProfileService`, `ReactionsService`), но по-прежнему без i18n-слоя.

---

## 8. Взаимодействие с другими компонентами

```
                     ┌──────────────────────┐        ┌───────────────────────────┐
  HTTP (клиент)  ──▶ │   ChatsController    │        │   GrpcChatController      │ ◀── gRPC (другие сервисы,
                     └──────────┬───────────┘        └───────────┬───────────────┘     напр. ReactionsService)
                                │                                │
                                └────────────────┬───────────────┘
                                                 ▼
                                        ┌───────────────────┐
                                        │   ChatsService    │
                                        └───┬───────────┬───┘
                                            │           │
                          Cassandra ◀───────┘           └───────▶ RabbitMQ: emit 'chat.read'
                (chats, chat_members,                            (очередь 'chat_events')
                 user_chats, chat_read_state)
```

- **Cassandra** — единственное хранилище состояния чатов в этом модуле.
- **RabbitMQ (`chat_events`)** — исходящий канал для события `chat.read`; та же очередь используется `ReactionsService` для `message.reaction` — оба потребляются, судя по всему, `gateway`-модулем (WebSocket-шлюз) этого же репозитория.
- **gRPC (`ChatInternal`)** — точка входа для других микросервисов, которым нужно узнать состав чата или проверить членство, не имея прямого доступа к таблицам Cassandra этого сервиса.

---

## 9. Сводная таблица методов и эндпоинтов

| Метод сервиса | Вызывается из | Проверка прав |
|---|---|---|
| `createChat` | `POST /chats` | — (любой авторизованный пользователь) |
| `getUserChats` | `GET /chats` | — |
| `addMembers` | `POST /chats/:chatId/members` | admin + чат должен быть `group` |
| `removeMember` | `DELETE /chats/:chatId/members/:userId` | admin |
| `markAsRead` | `POST /chats/:chatId/read` | участник чата |
| `isMember` | `GrpcChatController.isMember` (gRPC) | — (сам является проверкой) |
| `getMemberIds` | `GrpcChatController.getChatMembers` (gRPC) | — |
| `getReadState` | используется другим модулем (без REST-роута в этом контроллере) | — |
