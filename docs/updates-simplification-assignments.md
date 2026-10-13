# Задания первого раунда

Каждый исполнитель читает область и полный первый отчёт критика перед изменениями. Снимок исходного diff и файлов: /tmp/academy-updates-simplification-baseline.

## Frontend — updates_frontend

Файлы: client/src/features/updates/** и tests/platform-updates.dom.test.tsx.

Принятое решение по UPD-01/02/03: полностью удалить selectedCategory, category filter/badges/editor/preview/serializers/types/utilities, markAll handler/utility/count и кнопку, статистику/latest memo, clipboard buttons/handlers, action links/access calculations/редактор/тип черновика. Индивидуальное прочтение и общие уведомления сохраняются. Не оставлять пустые контейнеры и устаревшие imports/comments.

UPD-04: Card wrapper с w-full min-w-0 max-w-4xl, отдельный bg-card, border и rounded, вложенный семантический article с адаптивным padding p-4 sm:p-6 lg:p-8. Общий Card менять нельзя; asChild отсутствует. Защитить все heading/summary/items/caption/TOC/neighbor titles от длинных токенов; картинки width/max-width не расширяют статью. Сохранить возврат, оглавление, реакции и Dialog изображений.

Дополнительные замечания первого отчёта: убрать служебные HotkeyHint/SearchShortcutHint тексты, оставить рабочие shortcuts. Подтверждать clear draft/remove section/remove item существующим ConfirmDialog. До JSX новых текстов согласовать 3 кратких description ключа с backend; backend сначала добавляет RU/EN и запускает check:i18n. Восстановление старого черновика игнорирует category/action, учитывает заполненный sectionsEn. Другие UX-паттерны не менять.

UPD-06/07: использовать confirmation descriptions updatesClearDraftConfirm, updatesRemoveSectionConfirm, updatesRemoveItemConfirm. Сериализация sectionsRu/sectionsEn должна сохранять позиции неполных пунктов без независимого filter(Boolean), иначе RU и EN смещаются. Перед публикацией отклонять пункт с текстом только на одном языке (достаточно существующего updatesInvalidContent); оба пустых значения можно исключить. Статусы заполненности языка/preview согласовать с этими правилами. Адресные тесты должны подтверждать отсутствие смещения после восстановления и отказ публикации с неполным bullet при заполненном тексте.

Дополнение координатора к UPD-07: heading/body тоже нельзя молча отбрасывать из-за одностороннего перевода при наличии двуязычных bullets. Для optional heading/body проверить парность заполненности RU/EN, показать существующий validation alert при неполной паре; оба пустых допустимы по правилам контракта. Добавить тест одностороннего body с валидными bullets и одностороннего heading.

Согласованная находка взаимной проверки: глобальные Escape/arrow/J/K статьи не должны работать при открытом Dialog/AlertDialog (публикация и подтверждение тоже), а также при defaultPrevented. Frontend добавляет guard и DOM regression: клавиши внутри нового поста/confirmation не меняют маршрут и не вызывают навигацию под модальным окном.

Тесты: заменить ожидания удалённой функциональности проверкой отсутствия controls и отсутствия старых полей в опубликованном command; содержательно проверить article surface, legacy draft, индивидуальное прочтение, Dialog быстрого просмотра/картинки, отмену и подтверждение каждого удаления, поиск/год, RU/EN preview/publish и реакции/навигацию. Не подгонять ожидания под дефект.

## Backend — updates_backend

Файлы: shared/contracts/platform-updates.ts, server/modules/platform-updates/**, tests/platform-updates.routes.test.ts, tests/platform-updates.postgres.test.ts, новый адресный repository unit test; updates-ключи client/src/lib/i18n.ts.

UPD-01/03: удалить UpdateCategory/schema, content.category/action и action в releasePosts. Strict POST отклоняет оба удалённых поля. Удалить только ненужные updates-переводы, согласовав используемые ключи frontend, сохранить исходные чужие изменения i18n. Сначала добавить согласованные confirmation descriptions RU/EN и выполнить check:i18n перед использованием frontend.

Согласованные ключи: updatesClearDraftConfirm («Весь текст черновика будет удалён.» / «All draft content will be removed.»), updatesRemoveSectionConfirm («Раздел и его содержимое будут удалены.» / «The section and its content will be removed.»), updatesRemoveItemConfirm («Этот пункт будет удалён.» / «This item will be removed.»).

UPD-05: нормализовать исторический content только на выдаче и при сравнении идемпотентной публикации; удалить legacy category/action из представления, сохранить остальные поля и реальные конфликты. Общее active schema legacy поля не содержит. Не выполнять SQL UPDATE/миграции. Проверить list/find/findByKey/new publish/retry, не посылать notification на retry, реальные изменения title/summary/sections остаются конфликтом. Добавить API tests strict rejection и unit-тесты mock Pool; расширить postgres suite для CI, локальную БД/миграции не запускать.

## Общее и критерии готовности

- Исполнители напрямую согласуют DTO/legacy draft/i18n до реализации, обмениваются рисками во время работ. Договорённости кратко фиксируются здесь через координатора.
- После реализации каждый проверяет diff второго, передаёт замечания владельцу и координатору. Не править чужие файлы без согласования.
- До первого code change дождаться завершения первого отчёта критика. Все его новые ID автоматически входят в принятое выше решение, если соответствуют области; спорные решения передать координатору.
- Самостоятельно адресные проверки допустимы. После взаимной проверки координатор сам запускает tsc, тесты и static checks, затем критик повторно проверяет все ID и регрессии.
- Не использовать браузер, не создавать ветки, не коммитить/пушить исполнителям.

## Договорённости

- Исторические category/action не остаются частью активного контракта; backend нормализует выдачу и сравнение без миграции.
- Card не поддерживает asChild, потому wrapper + article сохраняет семантику без общей инфраструктурной правки.
- Восстановление EN-only sections необходимо для сохранения прежних черновиков.
- Исходная TS2417 в тесте board-user-avatar зафиксирована в scope, не относится к правкам updates.

## Уточнение после первого прогона DOM

Снимок до корректировки исходного кода: /tmp/academy-updates-simplification-round2.

При восстановлении исторического heading первого раздела поле ввода ранее скрывалось. Принято показывать heading input для sIndex > 0 или когда heading.ru/heading.en уже заполнен. Тогда пользователь может исправить отсутствующий перевод после validation, сохранив простой вид нового пустого первого раздела. Параметризованный DOM-тест проверяет отказ, заполнение EN и успешную публикацию без потери heading/body.

## Взаимная проверка и проверки координатора

- Frontend и backend напрямую согласовали контракт, historical draft и i18n до реализации, затем каждый проверил фактический diff второго. После завершающего исправления primary heading backend повторил review. Неразрешённых разногласий и замечаний взаимной проверки нет.
- Координатор проверил итоговый diff и содержание изменённых тестов, сам запустил 5 файлов: platform-updates.dom, platform-updates.routes, platform-updates.repository, notifications-menu.dom, notifications.routes. Все 62 теста прошли.
- lint, check:architecture, check:i18n, check:encoding, check:responsive и git diff --check прошли; предупреждения lint/i18n/architecture остаются неблокирующими.
- npx tsc --noEmit после раундов запускался координатором. Начальная ошибка board-avatar исправлена отдельной задачей, вошедшей в HEAD 6b6c4672. Затем общий checkout обнаружил TS2683 в незавершённом стороннем tests/helpers/photo-crop-browser.ts:44.
- Состав этой задачи отдельно проверен на HEAD 6b6c4672 + task-owned файлы и только updates-изменения i18n: npx tsc --noEmit --incremental false и npm run build прошли. Snapshot: /var/folders/75/syqp1mls1bn3ldvx2xvrysrm0000gn/T/academy-updates-simplification-verify-s0_583fp.
- PostgreSQL-тест исторических записей добавлен; локально integration suite не запускалась без отдельной тестовой БД. GitHub Actions сохраняет полный набор и PostgreSQL service перед deployment. Браузер не использовался.
