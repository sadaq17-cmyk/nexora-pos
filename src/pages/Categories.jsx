import { useEffect, useState } from "react";
import { ImagePlus, Plus, Pencil, Trash2, Save, X } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { readSecureImageDataUrl } from "../lib/secureImageUpload";
import { CATEGORY_ICONS, isCategoryActive, resolveCategoryIcon } from "../lib/categoryIcons";

const EMPTY_FORM = {
  name: "",
  color: "#2563EB",
  image_url: "",
  icon: "layers",
  active: true,
};

function categoryImage(category) {
  return category?.image_url || category?.image || "";
}

export default function Categories() {
  const { showToast } = useToast();
  const { can } = useAuth();
  const [categories, setCategories] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = async () => setCategories(await api.categories.getAll());

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (category) => {
    setEditing(category);
    setForm({
      name: category.name,
      color: category.color || "#2563EB",
      image_url: categoryImage(category),
      icon: category.icon || "layers",
      active: isCategoryActive(category),
    });
    setModalOpen(true);
  };

  const handleImageFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readSecureImageDataUrl(file, { maxBytes: 700 * 1024 });
      setForm((current) => ({ ...current, image_url: dataUrl }));
    } catch (uploadError) {
      showToast(uploadError?.message || "Image too large — keep under ~700KB or use a URL");
    }
  };

  const save = async (event) => {
    event.preventDefault();
    const payload = {
      name: form.name,
      color: form.color,
      image_url: form.image_url || "",
      image: form.image_url || "",
      icon: form.icon || "layers",
      active: Boolean(form.active),
    };
    const result = editing
      ? await api.categories.update({ id: editing.id, ...payload })
      : await api.categories.create(payload);
    if (!result.success) {
      showToast(result.error || "Could not save category");
      return;
    }
    setModalOpen(false);
    setForm(EMPTY_FORM);
    await load();
    showToast(editing ? "Category updated" : "Category created");
  };

  const remove = async (category) => {
    if (!confirm(`Delete "${category.name}"?`)) return;
    const result = await api.categories.delete(category.id);
    if (!result.success) {
      showToast(result.error || "Could not delete category");
      return;
    }
    await load();
    showToast("Category deleted");
  };

  return (
    <div className="animate-fadein">
      <div className="nx-page-header">
        <div>
          <h1 className="page-title">Categories</h1>
          <p className="nx-page-lead">
            Image, icon, name, and active state — shown as rounded cards on the POS category strip.
          </p>
        </div>
        {can("categories", "create") && (
          <button type="button" onClick={openCreate} className="btn btn-primary">
            <Plus size={15} /> Add Category
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {categories.map((category) => {
          const image = categoryImage(category);
          const active = isCategoryActive(category);
          const Icon = resolveCategoryIcon(category.icon);
          return (
            <div
              key={category.id}
              className={`card nx-category-admin-card ${active ? "" : "is-inactive"}`}
            >
              <div className="nx-category-admin-media">
                {image ? (
                  <img src={image} alt="" />
                ) : (
                  <div
                    className="flex h-full w-full items-center justify-center"
                    style={{ backgroundColor: category.color || "#2563EB" }}
                  >
                    <Icon size={30} color="#fff" aria-hidden />
                  </div>
                )}
              </div>
              <div className="nx-category-admin-body">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
                      style={{ backgroundColor: `color-mix(in srgb, ${category.color || "#2563EB"} 18%, transparent)`, color: category.color || "#2563EB" }}
                      aria-hidden
                    >
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="card-title truncate">{category.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={`nx-category-badge ${active ? "is-active" : "is-inactive"}`}>
                          {active ? "Active" : "Inactive"}
                        </span>
                        <span className="text-xs text-app-muted">
                          {image ? "Custom image" : "Icon placeholder"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {can("categories", "edit") && (
                      <button
                        type="button"
                        onClick={() => openEdit(category)}
                        className="rounded-lg p-2 text-app-muted hover:bg-app-panel-muted"
                        aria-label={`Edit ${category.name}`}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {can("categories", "delete") && (
                      <button
                        type="button"
                        onClick={() => remove(category)}
                        className="rounded-lg p-2 text-danger hover:bg-[var(--danger-soft)]"
                        aria-label={`Delete ${category.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <div className="nx-modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="nx-modal max-w-md p-6" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="card-title">{editing ? "Edit Category" : "Add Category"}</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="nx-icon-btn" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={save} className="space-y-3">
              <div>
                <label className="form-label">Category Name</label>
                <input
                  required
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  className="form-control w-full"
                />
              </div>
              <div>
                <label className="form-label">Icon</label>
                <div className="nx-icon-picker" role="group" aria-label="Category icon">
                  {CATEGORY_ICONS.map(({ id, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      className={form.icon === id ? "is-active" : ""}
                      onClick={() => setForm((current) => ({ ...current, icon: id }))}
                      aria-pressed={form.icon === id}
                      aria-label={id}
                    >
                      <Icon size={16} />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="form-label">Color</label>
                <input
                  type="color"
                  value={form.color}
                  onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
                  className="h-11 w-full rounded-lg border border-app p-1"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-app-text">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
                />
                Active (shown on POS)
              </label>
              <div>
                <label className="form-label">Category image</label>
                <div className="nx-category-image-preview">
                  {form.image_url ? (
                    <img src={form.image_url} alt="" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-app-muted">
                      <ImagePlus size={22} aria-hidden />
                      <span className="text-xs font-semibold">No image</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="btn btn-secondary cursor-pointer">
                    <ImagePlus size={15} aria-hidden />
                    Upload image
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="sr-only"
                      onChange={handleImageFile}
                    />
                  </label>
                  {form.image_url && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setForm((current) => ({ ...current, image_url: "" }))}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <p className="mt-2 text-xs text-app-muted">JPEG, PNG, WebP, or GIF · max ~700KB</p>
                <input
                  type="url"
                  placeholder="Or paste an image URL"
                  value={form.image_url?.startsWith("data:") ? "" : form.image_url}
                  onChange={(event) => setForm((current) => ({ ...current, image_url: event.target.value }))}
                  className="form-control mt-2 w-full"
                />
              </div>
              <button type="submit" className="btn btn-primary w-full">
                <Save size={15} /> {editing ? "Save Changes" : "Create Category"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
