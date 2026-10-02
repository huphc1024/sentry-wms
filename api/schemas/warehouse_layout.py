"""Pydantic schemas for editable warehouse floor plan."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class LayoutPoint(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    x: float
    y: float


class WarehouseLayoutConfig(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    coordinate_unit: Literal["METER", "LEGACY_CANVAS"] = "METER"
    world_width_m: float = Field(50, gt=0, le=500)
    world_height_m: float = Field(40, gt=0, le=500)
    warehouse_x_m: float = Field(2, ge=0)
    warehouse_y_m: float = Field(2, ge=0)
    warehouse_w_m: float = Field(46, gt=0)
    warehouse_h_m: float = Field(30, gt=0)
    grid_step_m: float = Field(0.25, gt=0, le=5)


class ZoneLayoutEntry(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    zone_id: int
    map_x: float
    map_y: float
    map_w: float = Field(..., gt=0)
    map_h: float = Field(..., gt=0)
    color_hex: str | None = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")


class RackLayoutEntry(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    rack_id: int | None = None
    rack_key: str = Field(..., min_length=1, max_length=120)
    zone_id: int | None = None
    label: str | None = None
    x_m: float
    y_m: float
    w_m: float = Field(..., gt=0)
    h_m: float = Field(..., gt=0)
    rotation_deg: float = Field(0, ge=0, lt=360)


class MapPathEntry(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    path_id: int | None = None
    path_type: Literal["FORKLIFT", "PEDESTRIAN"]
    label: str | None = None
    points: list[LayoutPoint] = Field(..., min_length=2)
    width_m: float = Field(2.5, gt=0, le=20)
    one_way: bool = False
    direction: Literal["both", "forward", "reverse"] = "both"
    sort_order: int = 0

    @model_validator(mode="after")
    def validate_direction(self):
        if self.one_way and self.direction == "both":
            raise ValueError("One-way paths require forward or reverse direction")
        if not self.one_way and self.direction != "both":
            raise ValueError("Two-way paths must use both direction")
        return self


class SaveWarehouseLayoutRequest(BaseModel):
    base_version: int = Field(..., ge=0)
    layout: WarehouseLayoutConfig
    zones: list[ZoneLayoutEntry] = Field(default_factory=list)
    racks: list[RackLayoutEntry] = Field(default_factory=list)
    paths: list[MapPathEntry] = Field(default_factory=list)

    @field_validator("paths")
    @classmethod
    def validate_paths(cls, paths: list[MapPathEntry]) -> list[MapPathEntry]:
        for path in paths:
            if len(path.points) < 2:
                raise ValueError("Each path requires at least two points")
            if any(
                a.x == b.x and a.y == b.y
                for a, b in zip(path.points, path.points[1:])
            ):
                raise ValueError("Adjacent path points must be distinct")
        return paths
