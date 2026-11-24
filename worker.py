#!/usr/bin/env python3
"""Starter JetPack Worker (dev.codingbro.ai-photo-studio)."""

from __future__ import annotations

import json
import os
import sys

# Allow importing jetpack_sdk both from installed venv and monorepo dev checkout
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_SDK_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "../../sdks/python"))
if os.path.isdir(REPO_SDK_DIR) and REPO_SDK_DIR not in sys.path:
    sys.path.insert(0, REPO_SDK_DIR)

from jetpack_sdk import JetPackClient


def handle_frame(client: JetPackClient, opcode: str, payload: bytes, channel_id: int, correlation_id: int | None) -> bool:
    if opcode in ("worker.ping", "app.ping"):
        client.send_frame(
            opcode="worker.pong" if opcode == "worker.ping" else "app.pong",
            payload=payload or b"pong",
            channel_id=channel_id,
            correlation_id=correlation_id,
        )
        return True

    if opcode == "worker.echo":
        client.send_frame(
            opcode="worker.echo.ok",
            payload=payload,
            channel_id=channel_id,
            correlation_id=correlation_id,
        )
        return True

    if opcode in ("app.terminate", "worker.stop"):
        client.send_frame(
            opcode="app.terminate.ok",
            payload=b"ok",
            channel_id=channel_id,
            correlation_id=correlation_id,
        )
        return False

    err = json.dumps({"error": f"Unsupported opcode '{opcode}'"}).encode("utf-8")
    client.send_frame(
        opcode="system.error",
        payload=err,
        channel_id=channel_id,
        correlation_id=correlation_id,
    )
    return True


def main() -> None:
    if "--standalone-test" in sys.argv:
        print("[dev.codingbro.ai-photo-studio] Standalone worker check OK", flush=True)
        return

    with JetPackClient() as client:
        print("[dev.codingbro.ai-photo-studio] Connected to JetPack daemon IPC", flush=True)
        while True:
            frame = client.read_frame()
            if frame is None:
                break
            keep_running = handle_frame(
                client,
                frame.opcode,
                frame.payload,
                frame.channel_id,
                frame.correlation_id,
            )
            if not keep_running:
                break


if __name__ == "__main__":
    main()
