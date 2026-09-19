import { Component, input } from "@angular/core";

import { Budget } from "../../core/api/models";
import { formatMoney } from "../../shared/utilities/money";

const budgetPercentFormatter = new Intl.NumberFormat("de-DE", {
  style: "percent", maximumFractionDigits: 2,
});

@Component({
  selector: "app-budget-usage",
  standalone: true,
  template: `
    <p>Spent {{ formatMoney(budget().spent) }} / Limit {{ formatMoney(budget().limitAmount) }}</p>
    @let progress = budget().progress;
    @if (progress !== null) {
      <p>{{ formatProgress(progress) }}</p>
    }
    @if (budget().remaining < 0) {
      <p><strong>Over budget</strong> by {{ formatMoney(-budget().remaining) }}</p>
    } @else if (budget().limitAmount === 0) {
      <p>Zero budget — no spending</p>
    } @else if (budget().remaining === 0) {
      <p>At budget</p>
    } @else {
      <p>Remaining {{ formatMoney(budget().remaining) }}</p>
    }
  `,
})
export class BudgetUsageComponent {
  readonly budget = input.required<Budget>();
  readonly formatMoney = formatMoney;
  readonly formatProgress = budgetPercentFormatter.format;
}
