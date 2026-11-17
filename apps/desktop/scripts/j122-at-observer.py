#!/usr/bin/python3
"""Bounded, passive AT-SPI evidence collector for the packaged native probe."""

import argparse
import collections
import json
import os
import pathlib
import signal
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--executable", required=True)
    args = parser.parse_args()
    output = pathlib.Path(args.output)
    if not output.is_absolute():
        parser.error("--output must be absolute")
    executable = os.path.realpath(args.executable)
    count = 0
    errors = 0
    written = 0
    limited = False
    started = time.monotonic()
    stream = output.open("x", encoding="utf-8", buffering=1)
    os.chmod(output, 0o600)

    def emit(kind, **fields):
        nonlocal count, written, limited
        if limited:
            return
        record = {"kind": kind, "at": int(time.time() * 1000), **fields}
        line = json.dumps(record, ensure_ascii=True) + "\n"
        if count >= 4000 or written + len(line) > 6 * 1024 * 1024:
            limited = True
            stream.write(json.dumps({"kind": "limit", "at": record["at"]}) + "\n")
            loop.quit()
            return
        stream.write(line)
        written += len(line)
        count += 1

    def report_error(operation, error):
        nonlocal errors
        errors += 1
        if errors <= 100:
            emit("error", operation=operation, error=str(error)[:500])

    try:
        import gi

        gi.require_version("Atspi", "2.0")
        from gi.repository import Atspi, GLib
    except Exception as error:
        stream.write(json.dumps({"kind": "error", "at": int(time.time() * 1000),
                                 "operation": "import-atspi", "error": str(error)}) + "\n")
        stream.close()
        return 1

    loop = GLib.MainLoop()
    Atspi.set_timeout(200, 1000)
    candidate_apps = {}
    event_types = [
        "window:create", "window:activate", "window:destroy",
        "document:load-complete", "document:load-stopped",
        "object:state-changed:focused", "object:children-changed:add",
        "object:property-change:accessible-name",
    ]

    def process_identity(pid):
        if pid <= 0:
            return {"pid": pid, "executable": None, "ancestors": []}
        ancestors = []
        current = pid
        actual_executable = None
        try:
            actual_executable = os.readlink(f"/proc/{pid}/exe")
            for _ in range(24):
                stat = pathlib.Path(f"/proc/{current}/stat").read_text()
                fields = stat[stat.rfind(")") + 2:].split()
                parent = int(fields[1])
                ancestors.append({"pid": current, "parentPid": parent,
                                  "startTicks": fields[19]})
                if parent <= 1:
                    break
                current = parent
        except (OSError, ValueError, IndexError) as error:
            report_error("process-identity", error)
        return {"pid": pid, "executable": actual_executable, "ancestors": ancestors}

    def identity(source):
        app = source.get_application()
        source_pid = source.get_process_id()
        app_pid = app.get_process_id() if app else source_pid
        source_process = process_identity(source_pid)
        app_process = process_identity(app_pid)
        candidate = any(item["executable"] == executable
                        for item in [source_process, app_process])
        return app, {"appPid": app_pid, "sourcePid": source_pid,
                     "appName": (app.get_name() or "")[:256] if app else "",
                     "appProcess": app_process, "sourceProcess": source_process,
                     "candidateExecutable": candidate}

    def snapshot(app, fields, reason):
        queue = collections.deque([(app, 0, False)])
        nodes = []
        visited = 0
        deadline = time.monotonic() + 0.15
        while queue and visited < 256 and time.monotonic() < deadline:
            node, depth, in_document = queue.popleft()
            visited += 1
            try:
                role = node.get_role_name() or ""
                in_document = in_document or role.startswith("document")
                name = (node.get_name() or "")[:256]
                text = ""
                if role in {"text", "static", "paragraph", "heading", "entry"}:
                    interface = node.get_text_iface()
                    if interface:
                        text = interface.get_text(0, min(interface.get_character_count(), 256))
                if name or text:
                    nodes.append({"role": role, "name": name, "text": text,
                                  "pid": node.get_process_id(),
                                  "inDocument": in_document})
                if depth < 10:
                    for index in range(min(node.get_child_count(), 64)):
                        child = node.get_child_at_index(index)
                        if child:
                            queue.append((child, depth + 1, in_document))
            except Exception as error:
                report_error("accessible-node", error)
        emit("tree", **fields, reason=reason, nodes=nodes,
             visited=visited, truncated=bool(queue))

    def on_event(event):
        try:
            source = event.source
            app, fields = identity(source)
            emit("event", **fields, event=event.type, role=source.get_role_name(),
                 name=(source.get_name() or "")[:256], detail1=event.detail1,
                 detail2=event.detail2)
            if fields["candidateExecutable"] and app:
                candidate_apps[fields["appPid"]] = (app, fields)
                snapshot(app, fields, event.type)
        except Exception as error:
            report_error("event", error)

    def poll():
        if limited:
            return False
        for app_pid, (app, fields) in list(candidate_apps.items()):
            try:
                if not pathlib.Path(f"/proc/{app_pid}").exists():
                    del candidate_apps[app_pid]
                    continue
                snapshot(app, fields, "passive-poll")
            except Exception as error:
                report_error("passive-poll", error)
        if time.monotonic() - started > 160:
            emit("limit", reason="runtime")
            loop.quit()
            return False
        return True

    def ready():
        emit("ready", pid=os.getpid(), eventTypes=event_types,
             atspiVersion=list(Atspi.get_version()), executable=executable)
        return False

    listener = Atspi.EventListener.new(on_event)
    try:
        for event_type in event_types:
            if not listener.register(event_type):
                raise RuntimeError(f"AT-SPI listener registration failed for {event_type}")
        GLib.idle_add(ready)
        GLib.timeout_add(250, poll)
        for sig in (signal.SIGINT, signal.SIGTERM):
            GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, sig, loop.quit)
        loop.run()
    except Exception as error:
        report_error("observer-loop", error)
        return 1
    finally:
        for event_type in event_types:
            try:
                listener.deregister(event_type)
            except Exception as error:
                report_error("deregister", error)
        emit("stopped", errors=errors, records=count, bytes=written, limited=limited)
        stream.close()
    return 1 if limited else 0


if __name__ == "__main__":
    sys.exit(main())
