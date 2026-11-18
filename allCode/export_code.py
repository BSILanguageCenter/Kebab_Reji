
import os

# Корень проекта
PROJECT_PATH = os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))
)

# Папка allCode
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))

# Выходные файлы
OUTPUT_FILE = os.path.join(
    OUTPUT_DIR, "all_source_code.txt"
)

INFO_FILE = os.path.join(
    OUTPUT_DIR, "project_info.txt"
)

# Исключённые папки
IGNORE_DIRS = {
    ".git",
    ".vscode",
    "node_modules",
    "allCode",
    "__pycache__",
    "dist",
    "build",
}

# Исключённые файлы
IGNORE_FILES = {
    ".gitignore",
    "README.md",
    "readme.md",
    "all_source_code.txt",
    "project_info.txt",
    "export_code.py",
}

def collect_project_files():

    total_files = 0
    total_lines = 0
    total_chars = 0

    file_statistics = []

    with open(OUTPUT_FILE, "w", encoding="utf-8") as output:

        for root, dirs, files in os.walk(PROJECT_PATH):

            dirs[:] = sorted(
                d for d in dirs if d not in IGNORE_DIRS
            )

            for filename in sorted(files):

                if filename in IGNORE_FILES:
                    continue

                file_path = os.path.join(root, filename)

                relative_path = os.path.relpath(
                    file_path, PROJECT_PATH
                )

                try:
                    with open(
                        file_path,
                        "r",
                        encoding="utf-8-sig"
                    ) as source:
                        content = source.read()

                    # Удаляем пустые строки
                    lines = [
                        line for line in content.splitlines()
                        if line.strip()
                    ]

                    cleaned_content = "\n".join(lines)

                    # Статистика файла
                    line_count = len(lines)
                    char_count = len(cleaned_content)

                    total_files += 1
                    total_lines += line_count
                    total_chars += char_count

                    file_statistics.append({
                        "name": relative_path,
                        "lines": line_count,
                        "chars": char_count,
                    })

                    # Записываем в общий TXT
                    output.write("=" * 100 + "\n")
                    output.write(f"FILE: {relative_path}\n")
                    output.write("=" * 100 + "\n\n")

                    output.write(cleaned_content)
                    output.write("\n\n\n")

                    print(f"[OK] {relative_path}")

                except UnicodeDecodeError:
                    print(f"[SKIP] Не текстовый файл: {relative_path}")

                except Exception as error:
                    print(f"[ERROR] {relative_path}: {error}")

    # Создаём файл статистики
    with open(INFO_FILE, "w", encoding="utf-8") as info:

        info.write("PROJECT STATISTICS\n")
        info.write("=" * 60 + "\n\n")

        info.write(f"Total files: {total_files}\n")
        info.write(f"Total lines: {total_lines}\n")
        info.write(f"Total characters: {total_chars}\n")

        info.write("\n\nFILE DETAILS\n")
        info.write("=" * 60 + "\n\n")

        for item in file_statistics:
            info.write(f"File: {item['name']}\n")
            info.write(f"Lines: {item['lines']}\n")
            info.write(f"Characters: {item['chars']}\n")
            info.write("-" * 40 + "\n")

    print("\n" + "=" * 60)
    print("PROJECT EXPORT COMPLETED")
    print("=" * 60)

    print(f"Files: {total_files}")
    print(f"Lines: {total_lines}")
    print(f"Characters: {total_chars}")

    print(f"\nSource code: {OUTPUT_FILE}")
    print(f"Statistics: {INFO_FILE}")


if __name__ == "__main__":
    collect_project_files()
