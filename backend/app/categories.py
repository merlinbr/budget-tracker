from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth.dependencies import HouseholdContext, require_household
from .db import get_db
from .errors import APIError
from .models import Category
from .schemas import CategoryCreate, CategoryResponse, CategoryUpdate


router = APIRouter(prefix="/api/categories", tags=["categories"])


def get_category(db: Session, category_id: int, household_id: int) -> Category:
    category = db.scalar(
        select(Category).where(
            Category.id == category_id, Category.household_id == household_id
        )
    )
    if category is None:
        raise APIError(404, "NOT_FOUND", "Resource not found.")
    return category


def category_response(category: Category) -> CategoryResponse:
    return CategoryResponse(
        id=category.id,
        name=category.name,
        type=category.type,
        is_archived=category.is_archived,
    )


@router.get("", response_model=list[CategoryResponse])
def list_categories(
    include_archived: bool = Query(False, alias="includeArchived"),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> list[CategoryResponse]:
    query = select(Category).where(Category.household_id == context.household_id)
    if not include_archived:
        query = query.where(Category.is_archived.is_(False))
    categories = db.scalars(
        query.order_by(Category.type, Category.name, Category.id)
    ).all()
    return [category_response(category) for category in categories]


@router.get("/{category_id}", response_model=CategoryResponse)
def get_category_route(
    category_id: int = Path(gt=0),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> CategoryResponse:
    return category_response(get_category(db, category_id, context.household_id))


@router.post("", status_code=201, response_model=CategoryResponse)
def create_category(
    payload: CategoryCreate,
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> CategoryResponse:
    category = Category(
        household_id=context.household_id,
        name=payload.name,
        type=payload.type,
    )
    db.add(category)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if getattr(exc.orig, "sqlite_errorname", None) == "SQLITE_CONSTRAINT_UNIQUE":
            raise APIError(
                409,
                "CONFLICT",
                "A category with this type and name already exists.",
                {"name": "Choose a different name."},
            ) from None
        raise
    db.refresh(category)
    return category_response(category)


@router.put("/{category_id}", response_model=CategoryResponse)
def update_category(
    payload: CategoryUpdate,
    category_id: int = Path(gt=0),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> CategoryResponse:
    category = get_category(db, category_id, context.household_id)
    if category.is_archived:
        raise APIError(409, "CONFLICT", "Archived categories are read-only.")
    category.name = payload.name
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if getattr(exc.orig, "sqlite_errorname", None) == "SQLITE_CONSTRAINT_UNIQUE":
            raise APIError(
                409,
                "CONFLICT",
                "A category with this type and name already exists.",
                {"name": "Choose a different name."},
            ) from None
        raise
    db.refresh(category)
    return category_response(category)


@router.post("/{category_id}/archive", status_code=204)
def archive_category(
    category_id: int = Path(gt=0),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> Response:
    category = get_category(db, category_id, context.household_id)
    if not category.is_archived:
        category.is_archived = True
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise
    return Response(status_code=204)
