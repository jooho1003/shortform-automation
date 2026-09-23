import json
import sys

from . import engine, store


def main(argv):
    try:
        if argv and argv[0] == "execute":
            engine.execute(argv[1], argv[2])
            return 0
        request = json.load(sys.stdin)
        action, payload = request.get("action"), request.get("payload", {})
        project_id = request.get("projectId")
        if action == "list":
            result = store.listing()
        elif action == "create":
            result = store.present(store.create(payload))
        elif action == "read":
            result = engine.state(project_id)
        elif action == "mutate":
            result = store.present(store.mutate(project_id, payload))
        elif action == "quote":
            result = engine.quote(store.read(project_id), payload)
            result.pop("request")
        elif action == "run":
            result = engine.prepare(project_id, payload)
        elif action == "resume":
            result = engine.resume(project_id, payload)
        else:
            raise store.StudioError("지원하지 않는 명령입니다.")
        print(json.dumps({"data": result}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc), "status": getattr(exc, "status", 500)}, ensure_ascii=False))
        return 1
