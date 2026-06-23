#!/usr/bin/env python3
"""Generate a review-friendly Markdown snapshot of the project's source code.

The report deliberately excludes dependencies, caches, build output, generated lock
files, binary assets, and the live application configuration that may hold secrets.
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
from pathlib import Path


DEFAULT_OUTPUT_NAME = "PROJECT_CODE_REPORT.md"

EXCLUDED_DIRECTORIES = {
    ".git",
    ".cache",
    ".vite",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "docs",
    "node_modules",
}

EXCLUDED_FILE_NAMES = {
    ".DS_Store",
    "app.config.json",
    "package-lock.json",
    DEFAULT_OUTPUT_NAME,
}

INCLUDED_FILE_NAMES = {
    ".dockerignore",
    ".editorconfig",
    ".gitattributes",
    ".gitignore",
    "Dockerfile",
    "_redirects",
    "components.json",
}

INCLUDED_EXTENSIONS = {
    ".css",
    ".dockerignore",
    ".editorconfig",
    ".gitattributes",
    ".gitignore",
    ".html",
    ".js",
    ".json",
    ".mjs",
    ".py",
    ".sql",
    ".svg",
    ".ts",
    ".tsx",
    ".yaml",
    ".yml",
}

LANGUAGES = {
    ".css": "css",
    ".html": "html",
    ".js": "js",
    ".json": "json",
    ".mjs": "js",
    ".py": "python",
    ".sql": "sql",
    ".svg": "xml",
    ".ts": "ts",
    ".tsx": "tsx",
    ".yaml": "yaml",
    ".yml": "yaml",
}


def should_include(path: Path, project_root: Path, output_path: Path) -> bool:
    """Return whether a project file belongs in the source snapshot."""
    relative_path = path.relative_to(project_root)

    if path == output_path or path.name in EXCLUDED_FILE_NAMES:
        return False

    if path.name.endswith((".lock", ".log")):
        return False

    if relative_path.parts[:2] == ("migrations", "meta"):
        return False

    if path.name in INCLUDED_FILE_NAMES:
        return True

    if path.name.startswith(".env."):
        return True

    if path.name.endswith(".d.ts"):
        return True

    return path.suffix in INCLUDED_EXTENSIONS


def source_files(project_root: Path, output_path: Path) -> list[Path]:
    """Collect included files, ignoring excluded directories while traversing."""
    files: list[Path] = []
    for path in project_root.rglob("*"):
        if not path.is_file() or any(part in EXCLUDED_DIRECTORIES for part in path.parts):
            continue
        if should_include(path, project_root, output_path):
            files.append(path)

    return sorted(files, key=lambda path: path.relative_to(project_root).as_posix())


def render_tree(files: list[Path], project_root: Path) -> str:
    """Build a compact Unicode tree of the included file paths."""
    root: dict[str, dict | None] = {}
    for path in files:
        node = root
        parts = path.relative_to(project_root).parts
        for index, part in enumerate(parts):
            is_file = index == len(parts) - 1
            if is_file:
                node[part] = None
            else:
                node = node.setdefault(part, {})  # type: ignore[assignment]

    lines: list[str] = []

    def add_nodes(node: dict[str, dict | None], prefix: str = "") -> None:
        entries = list(node.items())
        for index, (name, child) in enumerate(entries):
            is_last = index == len(entries) - 1
            connector = "└── " if is_last else "├── "
            lines.append(f"{prefix}{connector}{name}{'/' if child is not None else ''}")
            if child is not None:
                add_nodes(child, prefix + ("    " if is_last else "│   "))

    add_nodes(root)
    return "\n".join(lines)


def markdown_language(path: Path) -> str:
    if path.name == "Dockerfile":
        return "dockerfile"
    if path.name.endswith(".d.ts"):
        return "ts"
    return LANGUAGES.get(path.suffix, "text")


def file_section(path: Path, project_root: Path) -> str:
    relative_path = path.relative_to(project_root).as_posix()
    content = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    if not content.endswith("\n"):
        content += "\n"

    return f"### `{relative_path}`\n\n```{markdown_language(path)}\n{content}```\n"


def generate_report(project_root: Path, output_path: Path) -> int:
    files = source_files(project_root, output_path)
    generated_at = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S UTC")

    sections: list[str] = []
    for path in files:
        try:
            sections.append(file_section(path, project_root))
        except UnicodeDecodeError:
            # A misclassified binary file is safer to omit than to break the report.
            continue

    report = [
        "# Полный отчёт по исходному коду — 01 Academy CRM\n",
        f"Сформирован: {generated_at}\n",
        (
            "Этот файл предназначен для передачи модели на ревью. В него включены "
            f"**{len(sections)}** исходных и конфигурационных текстовых файлов проекта: "
            "клиент, сервер, общие типы, миграции, тесты, скрипты, Docker/CI-конфигурация "
            "и Telegram-бот.\n"
        ),
        "## Что намеренно исключено\n",
        "- зависимости и их кэши: `node_modules/`, `.git/`, `.vite/`, `.cache/`;\n"
        "- результаты сборки, тестов и покрытия: `dist/`, `build/`, `coverage/`;\n"
        "- логи, системные файлы и двоичные UI-ресурсы;\n"
        "- lock-файлы зависимостей (генерируются менеджером пакетов);\n"
        "- генерируемые Drizzle-снимки в `migrations/meta/`;\n"
        "- рабочий `config/app.config.json`, поскольку он может содержать секреты. "
        "Безопасный `config/app.config.example.json` включён.\n",
        "## Структура включённых файлов\n",
        f"```text\n{project_root.name}/\n{render_tree(files, project_root)}\n```\n",
        "## Содержимое файлов\n",
    ]

    report.extend(sections)

    output_path.write_text("\n".join(report), encoding="utf-8")
    return len(sections)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create a Markdown report containing the project's reviewable source files."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(DEFAULT_OUTPUT_NAME),
        help=f"Report path relative to the repository root (default: {DEFAULT_OUTPUT_NAME}).",
    )
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[1]
    output_path = args.output if args.output.is_absolute() else project_root / args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)

    included_count = generate_report(project_root, output_path)
    print(f"Created {output_path.relative_to(project_root)} with {included_count} source files.")


if __name__ == "__main__":
    main()
