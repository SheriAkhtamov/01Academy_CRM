import { publishUpdateSchema, type PublishUpdateCommand } from '@shared/contracts/platform-updates';

const text = (ru: string, en: string) => ({ ru, en });
export const releasePosts: PublishUpdateCommand[] = [publishUpdateSchema.parse({
  publicationKey: 'sales-groups-2026-10-12',
  content: {
    title: text('Группы теперь в модуле «Продажи»', 'Groups are now available in Sales'),
    summary: text('Находите подходящие группы, проверяйте свободные места и управляйте обучением прямо из модуля продаж.', 'Find suitable groups, check available seats and manage groups directly from Sales.'),
    action: { href: '/sales/groups' },
    sections: [
      { heading: text('Что изменилось', 'What changed'), paragraphs: [text(
        'В меню «Продажи» появился самостоятельный раздел «Группы». Здесь можно посмотреть курс, филиал, кабинет, преподавателя, расписание, вместимость и статус каждой группы.',
        'Sales now has a separate Groups section. Each group shows its course, branch, classroom, teacher, timetable, capacity and status.'), text(
        'Группы также остаются в «Структуре академии». Оба раздела показывают одни и те же группы: изменения, сохранённые в одном разделе, отображаются и в другом.',
        'Groups remain available in Academy structure. Both sections show the same groups, so saved changes appear in both places.')],
        image: { src: '/api/updates/images/2026-10-12-sales-groups/groups-list.jpg', caption: text('Раздел «Группы»: поиск и фильтры', 'Groups: search and filters') } },
      { heading: text('Как найти группу со свободными местами', 'How to find a group with available seats'),
        items: [text('Откройте «Продажи → Группы».', 'Open Sales → Groups.'),
          text('Введите название группы, курса, филиала или имя преподавателя в поиск.', 'Search for a group, course, branch or teacher.'),
          text('Выберите нужные курс, школу, преподавателя и статус. Чтобы найти группы без назначенного преподавателя, выберите «Не назначен» в фильтре преподавателей.', 'Choose the course, school, teacher and status. Select Not assigned to find groups without a teacher.'),
          text('В фильтре «Наличие мест» выберите «Есть свободные места». Брони лидов уже учтены в свободных местах.', 'Choose With available seats in Seat availability. Lead reservations are already included in the seat count.'),
          text('Нажмите «Сбросить фильтры», чтобы вернуться к полному списку.', 'Select Reset filters to return to the full list.')],
        paragraphs: [text('Например, если вместимость группы — 12 человек, учатся 7 и ещё 2 места забронированы, свободно 3 места.', 'For example, a group with capacity 12, seven students and two reserved seats has three available seats.')] },
      { heading: text('Как создать группу', 'How to create a group'),
        items: [text('Нажмите «Добавить группу».', 'Select Add group.'),
          text('Выберите курс, школу и кабинет. Укажите вместимость, количество и длительность уроков, дату начала и расписание по дням недели.', 'Choose the course, school and classroom. Set capacity, lesson count and duration, start date and weekly timetable.'),
          text('Выберите преподавателя.', 'Choose a teacher.'),
          text('Проверьте статус группы и сохраните форму.', 'Check the group status and save the form.')] },
      { heading: text('Редактирование и статусы', 'Editing and statuses'),
        paragraphs: [text('Нажмите на строку группы или значок редактирования. Откроется форма с текущими параметрами. Если закрыть её с несохранёнными изменениями, появится подтверждение.', 'Select a group row or its edit icon to open the current details. Closing with unsaved changes asks for confirmation.')],
        items: [text('«Набор открыт» — группа набирает учеников.', 'Enrollment open — the group is accepting students.'),
          text('«Идут занятия» — обучение началось.', 'In progress — teaching has started.'),
          text('«Заморожена» — занятия временно приостановлены.', 'Frozen — lessons are temporarily paused.'),
          text('«Завершена» — обучение окончено.', 'Completed — teaching has finished.')] },
      { heading: text('Архив и восстановление', 'Archive and restore'),
        paragraphs: [text('Чтобы убрать группу из активных списков и календарей, нажмите значок архива и подтвердите действие. Архивирование сохраняет историю группы и не меняет её учебный статус.', 'Use the archive icon and confirm to remove a group from active lists and calendars. Archiving preserves its history and does not change its teaching status.'),
          text('Чтобы вернуть группу, переключите список на «Архив» и нажмите «Вернуть из архива». Окончательно удалить можно только пустую архивную группу без учебной истории; удаление также требует подтверждения.', 'To restore a group, switch the list to Archive and select Restore from archive. Only an empty archived group with no teaching history can be permanently deleted, and deletion also requires confirmation.')] },
      { heading: text('На телефоне', 'On a phone'), paragraphs: [text('На узком экране группы показываются карточками. В карточке доступны сведения о группе и те же действия, что в таблице.', 'On narrow screens groups appear as cards, with the same details and actions as the table.')] },
      { heading: text('Уведомления об обновлениях', 'Update notifications'), paragraphs: [text('При публикации нового поста в «Что нового» сотрудники получают уведомление в колокольчике. Нажмите на уведомление, чтобы открыть соответствующий пост.', 'When a new What’s new post is published, employees receive a notification in the bell. Select it to open the corresponding post.')] },
    ],
  },
})];
