/**
 * Owner → Platform Super Admin approval workflow for sensitive actions.
 * Company Owners submit requests; Platform Super Admin approves or rejects.
 */

export const APPROVAL_REQUEST_TYPES = Object.freeze([
  {
    id: "company_suspend",
    label: "Suspend company",
    description: "Request platform suspension of the company account.",
    ownerInitiated: true,
  },
  {
    id: "company_reactivate",
    label: "Reactivate company",
    description: "Request reactivation of a suspended company.",
    ownerInitiated: true,
  },
  {
    id: "company_delete",
    label: "Delete company",
    description: "Request permanent deletion of the company (platform-only).",
    ownerInitiated: true,
  },
  {
    id: "plan_change",
    label: "Change subscription plan",
    description: "Request a plan upgrade, downgrade, or billing change.",
    ownerInitiated: true,
  },
  {
    id: "feature_override",
    label: "Feature access change",
    description: "Request enabling or disabling a platform feature for the company.",
    ownerInitiated: true,
  },
  {
    id: "owner_transfer",
    label: "Transfer ownership",
    description: "Request transferring company ownership to another user.",
    ownerInitiated: true,
  },
  {
    id: "domain_change",
    label: "Custom domain change",
    description: "Request adding, verifying, or removing a custom domain.",
    ownerInitiated: true,
  },
  {
    id: "data_export_purge",
    label: "Data export / purge",
    description: "Request a full data export or destructive purge.",
    ownerInitiated: true,
  },
  {
    id: "owner_account_action",
    label: "Owner account action",
    description: "Sensitive action on an Owner account requiring platform approval.",
    ownerInitiated: true,
  },
]);

export const APPROVAL_STATUSES = Object.freeze([
  "pending_owner",
  "pending_platform",
  "approved",
  "rejected",
  "cancelled",
]);

export function approvalTypeMeta(typeId) {
  return APPROVAL_REQUEST_TYPES.find((entry) => entry.id === typeId) || null;
}

export function isValidApprovalType(typeId) {
  return APPROVAL_REQUEST_TYPES.some((entry) => entry.id === typeId);
}

/** Owner submits directly to Platform Super Admin queue */
export function initialApprovalStatus() {
  return "pending_platform";
}

export function canSubmitApproval(role) {
  const key = String(role || "").toLowerCase();
  return key === "owner" || key === "company_owner";
}

export function canDecideApproval(role) {
  const key = String(role || "").toLowerCase().replace(/[\s-]+/g, "_");
  return key === "platform_owner" || key === "platformowner";
}

export function isOpenApprovalStatus(status) {
  return status === "pending_platform" || status === "pending_owner";
}
