import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";

import {
  Category,
  CategoryCreate,
  CategoryUpdate,
} from "../../core/api/models";

@Injectable({ providedIn: "root" })
export class CategoriesService {
  private readonly http = inject(HttpClient);

  list(includeArchived = false) {
    return this.http.get<Category[]>("/api/categories", { params: { includeArchived } });
  }

  get(id: number) {
    return this.http.get<Category>(`/api/categories/${id}`);
  }

  create(body: CategoryCreate) {
    return this.http.post<Category>("/api/categories", body);
  }

  update(id: number, body: CategoryUpdate) {
    return this.http.put<Category>(`/api/categories/${id}`, body);
  }

  archive(id: number) {
    return this.http.post<void>(`/api/categories/${id}/archive`, null);
  }
}
