import { localDateKey } from "./reportAnalytics";

const addDays = (date, amount) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const startOfWeek = (date) => addDays(date, -((date.getDay() + 6) % 7));

export const REPORT_PERIODS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["this_week", "This Week"],
  ["last_week", "Last Week"],
  ["this_month", "This Month"],
  ["last_month", "Last Month"],
  ["custom", "Custom Date Range"],
];

export function getReportRange(period, reference = new Date()) {
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  if (period === "yesterday") {
    const yesterday = addDays(today, -1);
    return { start_date: localDateKey(yesterday), end_date: localDateKey(yesterday) };
  }
  if (period === "this_week") {
    return { start_date: localDateKey(startOfWeek(today)), end_date: localDateKey(today) };
  }
  if (period === "last_week") {
    const end = addDays(startOfWeek(today), -1);
    return { start_date: localDateKey(addDays(end, -6)), end_date: localDateKey(end) };
  }
  if (period === "this_month") {
    return { start_date: localDateKey(new Date(today.getFullYear(), today.getMonth(), 1)), end_date: localDateKey(today) };
  }
  if (period === "last_month") {
    return {
      start_date: localDateKey(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      end_date: localDateKey(new Date(today.getFullYear(), today.getMonth(), 0)),
    };
  }
  return { start_date: localDateKey(today), end_date: localDateKey(today) };
}
