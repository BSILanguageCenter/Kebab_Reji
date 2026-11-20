
import os
import shutil
import zipfile

# ==========================================
# PROJECT PATHS
# ==========================================

PROJECT_PATH = os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))
)

SRC_PATH = os.path.join(PROJECT_PATH, "src")

OUTPUT_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

OUTPUT_FILE = os.path.join(
    OUTPUT_DIR,
    "src_all_source_code.txt"
)

INFO_FILE = os.path.join(
    OUTPUT_DIR,
    "src_project_info.txt"
)

ZIP_FILE = os.path.join(
    OUTPUT_DIR,
    "src_export.zip"
)


# ==========================================
# SETTINGS
# ==========================================

EXTENSIONS = (
    ".tsx",
    ".ts",
    ".css"
)

IGNORE_DIRS = {
    "node_modules",
    "__pycache__",
    "dist",
    "build",
}


# ==========================================
# COLLECT ALL FILES FROM SRC
# ==========================================

def collect_all_files():

    collected = []

    for root, dirs, files in os.walk(SRC_PATH):

        dirs[:] = sorted(
            d for d in dirs
            if d not in IGNORE_DIRS
        )

        for filename in sorted(files):

            file_path = os.path.join(
                root,
                filename
            )

            relative_path = os.path.relpath(
                file_path,
                PROJECT_PATH
            )

            collected.append({
                "path": file_path,
                "name": relative_path,
            })

    return collected


# ==========================================
# COLLECT SOURCE CODE
# ==========================================

def collect_source_code(all_files):

    collected = []

    for item in all_files:

        filename = item["name"]

        if not filename.lower().endswith(EXTENSIONS):
            continue

        try:

            with open(
                item["path"],
                "r",
                encoding="utf-8-sig"
            ) as source:

                content = source.read()

            lines = [
                line
                for line in content.splitlines()
                if line.strip()
            ]

            cleaned_content = "\n".join(lines)

            collected.append({
                "name": filename,
                "content": cleaned_content,
                "lines": len(lines),
                "chars": len(cleaned_content),
            })

            print(f"[CODE] {filename}")

        except UnicodeDecodeError:

            print(f"[SKIP] Encoding error: {filename}")

        except Exception as error:

            print(f"[ERROR] {filename}: {error}")

    return collected


# ==========================================
# CREATE SOURCE CODE TXT
# ==========================================

def create_source_file(files):

    with open(
        OUTPUT_FILE,
        "w",
        encoding="utf-8"
    ) as output:

        output.write("=" * 100 + "\n")
        output.write("SRC PROJECT - ALL SOURCE CODE\n")
        output.write(f"TOTAL FILES: {len(files)}\n")
        output.write("=" * 100 + "\n\n")

        output.write("FILES INCLUDED:\n\n")

        for index, item in enumerate(files, 1):

            output.write(
                f"{index:03d}. {item['name']}\n"
            )

        output.write("\n" + "=" * 100 + "\n")
        output.write("SOURCE CODE\n")
        output.write("=" * 100 + "\n\n")

        for item in files:

            output.write("=" * 100 + "\n")
            output.write(f"FILE: {item['name']}\n")
            output.write("=" * 100 + "\n\n")

            output.write(item["content"])
            output.write("\n\n\n")

    print(f"\n[SAVED] {OUTPUT_FILE}")


# ==========================================
# CREATE ZIP WITH SRC FOLDER
# ==========================================

def create_src_zip():

    if os.path.exists(ZIP_FILE):
        os.remove(ZIP_FILE)

    total = 0

    with zipfile.ZipFile(
        ZIP_FILE,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9
    ) as archive:

        for root, dirs, files in os.walk(SRC_PATH):

            dirs[:] = sorted(
                d for d in dirs
                if d not in IGNORE_DIRS
            )

            for filename in sorted(files):

                file_path = os.path.join(
                    root,
                    filename
                )

                arcname = os.path.relpath(
                    file_path,
                    PROJECT_PATH
                )

                archive.write(
                    file_path,
                    arcname
                )

                total += 1

                print(f"[ZIP] {arcname}")

    print(f"\n[SAVED] {ZIP_FILE}")
    print(f"ZIP FILES: {total}")


# ==========================================
# CREATE PROJECT STATISTICS
# ==========================================

def create_statistics(code_files, all_files):

    total_files = len(all_files)

    code_files_count = len(code_files)

    total_lines = sum(
        item["lines"]
        for item in code_files
    )

    total_chars = sum(
        item["chars"]
        for item in code_files
    )

    with open(
        INFO_FILE,
        "w",
        encoding="utf-8"
    ) as info:

        info.write("SRC PROJECT STATISTICS\n")
        info.write("=" * 60 + "\n\n")

        info.write(f"Total SRC files: {total_files}\n")
        info.write(f"Source code files: {code_files_count}\n")
        info.write(f"Total lines: {total_lines}\n")
        info.write(f"Total characters: {total_chars}\n")

        info.write("\n\nSOURCE CODE FILE DETAILS\n")
        info.write("=" * 60 + "\n\n")

        for item in code_files:

            info.write(f"File: {item['name']}\n")
            info.write(f"Lines: {item['lines']}\n")
            info.write(f"Characters: {item['chars']}\n")
            info.write("-" * 40 + "\n")

        info.write("\n\nALL SRC FILES\n")
        info.write("=" * 60 + "\n\n")

        for index, item in enumerate(all_files, 1):

            info.write(
                f"{index:03d}. {item['name']}\n"
            )

    print(f"\n[SAVED] {INFO_FILE}")


# ==========================================
# MAIN
# ==========================================

def main():

    print("\n" + "=" * 60)
    print("SRC PROJECT EXPORTER")
    print("=" * 60)

    if not os.path.isdir(SRC_PATH):

        print(f"\nERROR: src folder not found: {SRC_PATH}")
        return

    os.makedirs(
        OUTPUT_DIR,
        exist_ok=True
    )

    print("\nScanning SRC folder...\n")

    all_files = collect_all_files()

    print(f"Found files: {len(all_files)}")

    print("\nCollecting source code...\n")

    code_files = collect_source_code(all_files)

    print("\nCreating source code TXT...\n")

    create_source_file(code_files)

    print("\nCreating SRC ZIP archive...\n")

    create_src_zip()

    print("\nCreating project statistics...\n")

    create_statistics(
        code_files,
        all_files
    )

    total_lines = sum(
        item["lines"]
        for item in code_files
    )

    total_chars = sum(
        item["chars"]
        for item in code_files
    )

    print("\n" + "=" * 60)
    print("EXPORT COMPLETED")
    print("=" * 60)

    print(f"Total SRC files: {len(all_files)}")
    print(f"Source code files: {len(code_files)}")
    print(f"Total lines: {total_lines}")
    print(f"Total characters: {total_chars}")

    print("\nGenerated files:")
    print("- src_all_source_code.txt")
    print("- src_project_info.txt")
    print("- src_export.zip")

    print("\nOutput folder:")
    print(OUTPUT_DIR)

    print("=" * 60)


if __name__ == "__main__":
    main()
