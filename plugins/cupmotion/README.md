# cupmotion

Моушен-студия для Claude Code: ролики, промо, объяснялки, клипы и анимации кодом — от раскадровки до проверенного MP4 со звуком.
Хук `hooks/route.mjs` читает каждое сообщение и по словарю `skills/cupmotion/routes.json` сам подключает нужные стили, справочники и сайты
(«в 3д», «пиксель», «рисованный», «объяснялка», «клип»…). Сообщения не про видео он пропускает молча.

Установка: `claude plugin install cupmotion --marketplace yearofcodeking/cupmotion`, затем перезапуск Claude Code.

Нужно заранее: Node.js 18+, ffmpeg, Chrome или Edge. Перед первым рендером Claude сам запустит `scripts/doctor.mjs`:
проверит окружение и один раз поставит `playwright-core` в `~/.cupmotion`.
Делегирование (с версии 1.3.0): для роликов из 3+ независимых частей главный пишет контракт и раздаёт части рабочим `cupmotion-worker`
параллельно (`agents/cupmotion-worker.md`, `references/delegation.md`). Модель и effort рабочих — по умолчанию `opus` / `medium`, меняются в агенте или в `cupmotion.local.md`.
Личные правила — `~/.claude/cupmotion.local.md`, свои слова-триггеры — `~/.claude/cupmotion.routes.json`.
Подробная инструкция и таблица триггеров — в README репозитория.
