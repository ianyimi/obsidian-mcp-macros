"""
title: Filesystem Tools (Claude Code style)
author: zaye
version: 1.0.0
description: Direct filesystem access for OpenWebUI agents, matching Claude Code's capabilities
"""

import os
import subprocess
from pathlib import Path
from typing import Optional, List
import glob as glob_module

class Tools:
    def __init__(self):
        # Base directory - agents can access anything under here
        self.base_path = Path("/Users/zaye/Documents")

        # Or allow full system access (use with caution)
        # self.base_path = Path("/")

    # ========================================
    # CORE TOOLS (matching Claude Code)
    # ========================================

    def read(self, file_path: str, __user__: dict = {}) -> str:
        """
        Read a file from the filesystem.

        :param file_path: Absolute or relative path to file

        Example:
        read("/Users/zaye/Documents/Vault/People/John.md")
        read("Vault/People/John.md")  # relative to base_path
        """
        path = self._resolve_path(file_path)

        if not path.exists():
            return f"Error: File not found: {file_path}"

        if not path.is_file():
            return f"Error: Not a file: {file_path}"

        try:
            content = path.read_text(encoding='utf-8')
            return content
        except Exception as e:
            return f"Error reading file: {str(e)}"

    def write(
        self,
        file_path: str,
        content: str,
        __user__: dict = {}
    ) -> str:
        """
        Write content to a file (creates or overwrites).

        :param file_path: Absolute or relative path to file
        :param content: Content to write

        Example:
        write("Vault/People/New Person.md", "---\\ntype: person\\n---\\n\\n# Biography")
        """
        path = self._resolve_path(file_path)

        try:
            # Create parent directories if needed
            path.parent.mkdir(parents=True, exist_ok=True)

            # Write file
            path.write_text(content, encoding='utf-8')

            return f"✓ Wrote to: {path}"
        except Exception as e:
            return f"Error writing file: {str(e)}"

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        __user__: dict = {}
    ) -> str:
        """
        Find and replace text in a file.

        :param file_path: Absolute or relative path to file
        :param old_string: Text to find
        :param new_string: Text to replace with

        Example:
        edit("Vault/People/John.md", "status: inactive", "status: active")
        """
        path = self._resolve_path(file_path)

        if not path.exists():
            return f"Error: File not found: {file_path}"

        try:
            content = path.read_text(encoding='utf-8')

            if old_string not in content:
                return f"Error: String not found in file: {old_string}"

            # Replace
            new_content = content.replace(old_string, new_string, 1)

            # Write back
            path.write_text(new_content, encoding='utf-8')

            return f"✓ Edited: {path}"
        except Exception as e:
            return f"Error editing file: {str(e)}"

    def bash(
        self,
        command: str,
        cwd: Optional[str] = None,
        __user__: dict = {}
    ) -> str:
        """
        Execute a shell command.

        :param command: Shell command to run
        :param cwd: Working directory (optional)

        Examples:
        bash("ls -la Vault/People")
        bash("find Vault -name '*.md' -mtime -7")
        bash("grep -r 'project' Vault/Projects")
        """
        if cwd:
            working_dir = self._resolve_path(cwd)
        else:
            working_dir = self.base_path

        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                cwd=str(working_dir),
                timeout=30
            )

            output = result.stdout
            if result.stderr:
                output += f"\n[stderr]: {result.stderr}"

            return output if output else "(no output)"
        except subprocess.TimeoutExpired:
            return "Error: Command timed out after 30 seconds"
        except Exception as e:
            return f"Error executing command: {str(e)}"

    def glob(
        self,
        pattern: str,
        base_dir: Optional[str] = None,
        __user__: dict = {}
    ) -> str:
        """
        Find files matching a glob pattern.

        :param pattern: Glob pattern (e.g., "**/*.md", "People/*.md")
        :param base_dir: Directory to search in (optional)

        Examples:
        glob("**/*.md")  # All markdown files
        glob("People/*.md")  # Files in People folder
        glob("**/2025-*.md")  # Files matching date pattern
        """
        if base_dir:
            search_path = self._resolve_path(base_dir)
        else:
            search_path = self.base_path

        try:
            # Use pathlib for glob
            matches = list(search_path.glob(pattern))

            # Convert to relative paths
            results = [str(p.relative_to(search_path)) for p in matches if p.is_file()]

            if not results:
                return f"No files found matching: {pattern}"

            return "\n".join(sorted(results))
        except Exception as e:
            return f"Error searching files: {str(e)}"

    def grep(
        self,
        pattern: str,
        search_path: Optional[str] = None,
        file_pattern: str = "*.md",
        __user__: dict = {}
    ) -> str:
        """
        Search file contents for a pattern.

        :param pattern: Text or regex to search for
        :param search_path: Directory to search in (optional)
        :param file_pattern: File pattern to search (default: *.md)

        Examples:
        grep("vector search")
        grep("type: person", "Vault/People")
        grep("TODO", file_pattern="**/*.md")
        """
        if search_path:
            base = self._resolve_path(search_path)
        else:
            base = self.base_path

        try:
            # Use grep command for speed
            cmd = f"grep -r -n -i '{pattern}' --include='{file_pattern}' ."

            result = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                cwd=str(base),
                timeout=30
            )

            if result.returncode == 0:
                return result.stdout
            elif result.returncode == 1:
                return f"No matches found for: {pattern}"
            else:
                return f"Error: {result.stderr}"
        except Exception as e:
            return f"Error searching: {str(e)}"

    # ========================================
    # HELPER METHODS
    # ========================================

    def _resolve_path(self, file_path: str) -> Path:
        """Convert relative or absolute path to absolute Path object."""
        path = Path(file_path)

        # If absolute, return as-is
        if path.is_absolute():
            return path

        # If relative, resolve from base_path
        return self.base_path / path

    # ========================================
    # ADDITIONAL UTILITIES
    # ========================================

    def list_dir(
        self,
        dir_path: str = "",
        __user__: dict = {}
    ) -> str:
        """
        List contents of a directory.

        :param dir_path: Directory to list (default: base_path)
        """
        if dir_path:
            path = self._resolve_path(dir_path)
        else:
            path = self.base_path

        if not path.exists():
            return f"Error: Directory not found: {dir_path}"

        if not path.is_dir():
            return f"Error: Not a directory: {dir_path}"

        try:
            items = []
            for item in sorted(path.iterdir()):
                prefix = "[DIR]" if item.is_dir() else "[FILE]"
                items.append(f"{prefix} {item.name}")

            return "\n".join(items) if items else "(empty directory)"
        except Exception as e:
            return f"Error listing directory: {str(e)}"

    def file_info(
        self,
        file_path: str,
        __user__: dict = {}
    ) -> str:
        """
        Get information about a file.

        :param file_path: Path to file
        """
        path = self._resolve_path(file_path)

        if not path.exists():
            return f"Error: File not found: {file_path}"

        try:
            stat = path.stat()

            from datetime import datetime
            mtime = datetime.fromtimestamp(stat.st_mtime)

            info = {
                "path": str(path),
                "size": f"{stat.st_size:,} bytes",
                "modified": mtime.strftime("%Y-%m-%d %H:%M:%S"),
                "is_file": path.is_file(),
                "is_dir": path.is_dir()
            }

            import json
            return json.dumps(info, indent=2)
        except Exception as e:
            return f"Error getting file info: {str(e)}"

    def mkdir(
        self,
        dir_path: str,
        __user__: dict = {}
    ) -> str:
        """
        Create a directory (and parent directories if needed).

        :param dir_path: Directory path to create
        """
        path = self._resolve_path(dir_path)

        try:
            path.mkdir(parents=True, exist_ok=True)
            return f"✓ Created directory: {path}"
        except Exception as e:
            return f"Error creating directory: {str(e)}"

    def delete(
        self,
        file_path: str,
        __user__: dict = {}
    ) -> str:
        """
        Delete a file. USE WITH CAUTION.

        :param file_path: Path to file to delete
        """
        path = self._resolve_path(file_path)

        if not path.exists():
            return f"Error: File not found: {file_path}"

        try:
            if path.is_file():
                path.unlink()
                return f"✓ Deleted file: {path}"
            else:
                return f"Error: Not a file (use rmdir for directories): {file_path}"
        except Exception as e:
            return f"Error deleting file: {str(e)}"

    def append(
        self,
        file_path: str,
        content: str,
        __user__: dict = {}
    ) -> str:
        """
        Append content to a file.

        :param file_path: Path to file
        :param content: Content to append
        """
        path = self._resolve_path(file_path)

        if not path.exists():
            return f"Error: File not found: {file_path}"

        try:
            with open(path, 'a', encoding='utf-8') as f:
                f.write(content)

            return f"✓ Appended to: {path}"
        except Exception as e:
            return f"Error appending to file: {str(e)}"


# ========================================
# USAGE EXAMPLE FOR AGENT
# ========================================

"""
Agent workflow (mimicking Claude Code):

User: "Create a person note for John Doe, engineer at Acme"

Agent reasoning:
1. First, let me see how person notes are structured
2. Read an example
3. Create new note following the pattern

Agent actions:

# Step 1: See what person notes look like
result = glob("Vault/People/*.md")
# Returns: "Jane Smith.md\nBob Jones.md\n..."

# Step 2: Read an example
example = read("Vault/People/Jane Smith.md")
# Returns full file content

# Step 3: Create new note following the pattern
new_content = '''---
type: person
name: John Doe
company: Acme
role: Engineer
lastContact: 2025-01-16
status: active
tags:
  - person
  - contact
---

## Biography
John Doe is an engineer at Acme.

## Interactions

## Notes
'''

result = write("Vault/People/John Doe.md", new_content)
# Returns: "✓ Wrote to: /Users/zaye/Documents/Vault/People/John Doe.md"

Agent response to user: "Created a person note for John Doe at Vault/People/John Doe.md"
"""
