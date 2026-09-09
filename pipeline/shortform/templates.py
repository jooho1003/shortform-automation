"""렌더 템플릿 카탈로그와 영상 길이 규칙."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

from . import StepFailed
from .paths import CONFIG


@dataclass(frozen=True)
class Template:
    id: str
    name: str
    duration: tuple[float, float]
    enforce_duration: bool


@dataclass(frozen=True)
class Catalog:
    default_id: str
    templates: tuple[Template, ...]

    def by_id(self, template_id: str) -> Template:
        for template in self.templates:
            if template.id == template_id:
                return template
        raise StepFailed(f"알 수 없는 템플릿 ID입니다: {template_id}")

    def by_name(self, name: str) -> Template:
        for template in self.templates:
            if template.name == name:
                return template
        valid = ", ".join(template.name for template in self.templates)
        raise StepFailed(f"알 수 없는 템플릿입니다: {name}. 사용 가능: {valid}")


def load_catalog(path: Path | None = None) -> Catalog:
    source = path or CONFIG / "templates.yaml"
    try:
        raw = yaml.safe_load(source.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise StepFailed(f"템플릿 설정을 읽지 못했습니다: {source}") from exc

    try:
        default_id = raw["default"]
        entries = raw["templates"]
        if not isinstance(default_id, str) or not default_id.strip():
            raise ValueError
        if not isinstance(entries, list) or not entries:
            raise ValueError

        parsed: list[Template] = []
        ids: set[str] = set()
        names: set[str] = set()
        for entry in entries:
            template_id = entry["id"]
            name = entry["name"]
            bounds = entry["duration"]
            enforced = entry["enforce_duration"]
            if not isinstance(template_id, str) or not template_id.strip():
                raise ValueError
            if not isinstance(name, str) or not name.strip():
                raise ValueError
            if template_id in ids or name in names:
                raise ValueError
            if not isinstance(bounds, list) or len(bounds) != 2:
                raise ValueError
            if any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in bounds):
                raise ValueError
            minimum, maximum = bounds
            if minimum <= 0 or maximum <= 0 or minimum > maximum:
                raise ValueError
            if not isinstance(enforced, bool):
                raise ValueError
            ids.add(template_id)
            names.add(name)
            parsed.append(
                Template(
                    id=template_id,
                    name=name,
                    duration=(float(minimum), float(maximum)),
                    enforce_duration=enforced,
                )
            )
    except (KeyError, TypeError, ValueError) as exc:
        raise StepFailed(f"템플릿 설정 형식이 잘못되었습니다: {source}") from exc

    catalog = Catalog(default_id=default_id, templates=tuple(parsed))
    if default_id not in ids:
        raise StepFailed(f"기본 템플릿이 카탈로그에 없습니다: {default_id}")
    return catalog


def resolve_template(name: str | None, catalog: Catalog | None = None) -> Template:
    catalog = catalog or load_catalog()
    return catalog.by_name(name) if name else catalog.by_id(catalog.default_id)


def validate_duration(
    template_id: str, duration: float, catalog: Catalog | None = None
) -> None:
    template = (catalog or load_catalog()).by_id(template_id)
    if not template.enforce_duration:
        return
    minimum, maximum = template.duration
    if not minimum <= duration <= maximum:
        raise StepFailed(
            f"{template.name} 영상은 {minimum:g}~{maximum:g}초여야 합니다 "
            f"(현재 {duration:.3f}초)."
        )
