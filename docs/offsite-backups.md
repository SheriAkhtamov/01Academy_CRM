# Внешние резервные копии CRM

Production-сервер создаёт каждый час полный ZIP с PostgreSQL dump и каталогом
`uploads/`. Отдельный физический сервер самостоятельно забирает опубликованные
архивы. Production-сервер не имеет ключа и прав доступа к физическому серверу.

## Хранение

- production-сервер: последние 10 полных архивов;
- физический сервер: все ежечасные архивы за последние 90 дней;
- каталог физического сервера: `/srv/backups/01academy-crm/hourly`.

Перед сохранением физический сервер независимо проверяет:

- внешнюю SHA-256 сумму ZIP;
- целостность ZIP;
- наличие `database.dump`, `manifest.json` и `uploads/`;
- SHA-256 дампа из манифеста;
- читаемость PostgreSQL custom dump через `pg_restore --list`.

Архивы удаляются на физическом сервере только его локальным скриптом ротации.
Удаление или компрометация production-сервера не распространяется на уже
полученную внешнюю историю.

## Проверка состояния

На физическом сервере:

```bash
sudo systemctl status 01academy-offsite-backup.timer
sudo systemctl status 01academy-offsite-backup.service
sudo journalctl -u 01academy-offsite-backup.service -n 100 --no-pager
sudo cat /srv/backups/01academy-crm/.last-success
sudo ls -lh /srv/backups/01academy-crm/hourly
```

Ручной безопасный запуск:

```bash
sudo systemctl start 01academy-offsite-backup.service
```

## Восстановление

Сначала скопировать выбранный архив в отдельный рабочий каталог и проверить
контрольную сумму. Восстановление всегда проверять на временной базе, не
перезаписывая действующую production-базу.

```bash
cd /srv/backups/01academy-crm/hourly
sha256sum -c academy-crm-backup-YYYYMMDDTHHMMSSZ.zip.sha256
unzip academy-crm-backup-YYYYMMDDTHHMMSSZ.zip -d /tmp/academy-crm-restore
pg_restore --list /tmp/academy-crm-restore/database.dump >/dev/null
```

Физический сервер сейчас использует один линейный LVM-том поверх нескольких
дисков. Такой том не имеет отказоустойчивости: выход любого диска может повредить
весь том. Для окончательной схемы 3-2-1 нужна ещё одна зашифрованная копия либо
перевод backup-хранилища на зеркальный RAID/ZFS.
