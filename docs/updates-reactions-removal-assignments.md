# Первый раунд удаления оценок обновлений

Все агенты читают scope и полный первый report. Снимок до исправлений: /tmp/academy-updates-reactions-baseline. Новые пользовательские тексты и API не нужны.

## Frontend — updates_frontend

Владелец UpdateArticle.tsx и tests/platform-updates.dom.test.tsx.

- REACT-01: удалить весь контейнер оценок со всеми кнопками, заголовком, feedback и counters; удалить state/effect/handler и imports реакций. Не оставлять пустой блок и дополнительное место. Структура Card/article, секции, progress, TOC, соседняя навигация, кнопка наверх и Dialog изображения сохраняются.
- REACT-04: заменить прежний test toggle reactions параметризованной RU/EN регрессией. До mount сохранить retired ratings для post 5 и 4. После seed шпионить getItem/setItem/removeItem/clear хранилища; открыть 5, перейти соседней ссылкой в 4, проверить отсутствие прежнего заголовка/feedback/трёх кнопок и отсутствие любых обращений к retired key или общей очистки хранилища. Legacy JSON не меняется. Проверку самого JSON выполнить после остановки spy или исключить собственное тестовое чтение из assertions. Mock find отвечает по id. Сохранить другие tests чтения/навигации/редактора/модальных.
- До реализации согласовать границы с utils/i18n владельцем, после реализации проверить его фактический diff и сообщить замечания. Чужие файлы не менять.

## Utils / локализация — updates_backend

Владелец utils.ts и только пяти keys i18n.

- REACT-02: полностью удалить блок Employee reaction utilities: REACTIONS_STORAGE_KEY, ReactionType, PostReactions, StoredReactionsMap, getPostReactions, togglePostReaction и относящиеся к ним комментарии. Read-status / PublishDraft utilities остаются без поведенческих правок. Не добавлять localStorage cleanup или заменяющие compatibility функции.
- REACT-03: удалить updatesReactionsTitle, updatesReactionHelpful, updatesReactionAwesome, updatesReactionExcited, updatesReactionFeedback (RU/EN entries целиком). Сохранить чужие chat i18n changes. Никаких других ключей не удалять.
- Проверить frontend diff и regression tests после реализации, особенно отсутствие imports и storage access при смене post. Сообщить владельцу и координатору замечания. Код frontend не менять.

## Приёмка раунда

Исполнители напрямую обсудили удаление UI/storage без runtime cleanup; подтверждают отсутствие оставшихся активных names. После реализации каждый проводит взаимный review другого. Координатор сам проверяет diff и содержание tests, запускает npx tsc --noEmit и адресные сценарии/обязательные static checks. Затем независимый критик сверяет все REACT-01..04, ищет регрессии и явно одобряет результат. Не коммитить, не пушить и не открывать браузер исполнителям.

## Договорённость по regression harness

Первый прогон выявил, что setup может подставлять MemoryStorage, поэтому шпионить нужно Object.getPrototypeOf(window.localStorage), приведённый к Storage, а не безусловный Storage.prototype. Добавить positive-control: getItem/setItem spies действительно наблюдают read-posts при обычном прочтении. Это исключает ложно успешную проверку отсутствия обращений retired key. Original getter используется только для собственных assertions и не входит в наблюдаемые действия приложения.

## Выполненная проверка раунда

- Исполнители напрямую согласовали отсутствие cleanup и границы владельцев; после реализации каждый проверил фактические изменения второго. Backend повторно проверил исправленный harness и positive controls. Открытых замечаний взаимной проверки нет.
- Координатор самостоятельно проверил итоговый app diff и содержание изменённых tests, затем выполнил npx tsc --noEmit (успех), адресный platform-updates.dom test (26/26), scoped ESLint с max-warnings 0, check:i18n, check:architecture, check:encoding, check:responsive и git diff --check (все прошли).
- Существующие неблокирующие maintenance recommendations i18n/architecture не менялись ради приёмки. Чужие chat/login правки не входят в коммит удаления оценок.
- Браузер, скриншоты и миграции не использовались. Полный набор тестов и сборка остаются в GitHub Actions перед deployment.
