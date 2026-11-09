/* 标签选择弹窗内部视图：分类页签、标签云、已选区与目录状态行。 */
import { icon } from "../icons.js";
import { catalogTag, getTagCatalogError } from "./catalog.js";
import { TAG_TYPES } from "./constants.js";
import { el } from "./utils.js";
  export function renderTagTabs(ctx, state) {
    const tabs = state.dom.tagTabs;
    if (!tabs) return;
    tabs.textContent = "";
    for (const [id, label] of TAG_TYPES) {
      const count = [...state.tagDraft].filter((tagId) => {
        const tag = catalogTag(tagId);
        return tag && Number(tag.type) === id;
      }).length;
      const btn = el("button", "lib-tag-tab");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.appendChild(el("span", "", label));
      if (count) btn.appendChild(el("span", "lib-tag-tab-count", String(count)));
      const on = state.tagType === id;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.addEventListener("click", () => {
        if (state.tagType === id) return;
        state.tagType = id;
        state.tagQuery = "";
        if (state.dom.tagSearchInput) state.dom.tagSearchInput.value = "";
        ctx.api.renderTagModal(ctx, state);
      });
      tabs.appendChild(btn);
    }
  }
  export function tagChip(ctx, state, tag) {
    const chip = el("button", "lib-tag-chip", tag.name);
    chip.type = "button";
    chip.dataset.id = String(tag.id);
    const on = state.tagDraft.has(Number(tag.id));
    chip.classList.toggle("on", on);
    chip.setAttribute("aria-pressed", on ? "true" : "false");
    chip.addEventListener("click", () => {
      const id = Number(tag.id);
      if (state.tagDraft.has(id)) state.tagDraft.delete(id);
      else state.tagDraft.add(id);
      ctx.api.renderTagModal(ctx, state);
    });
    return chip;
  }
  export function renderTagCatalog(ctx, state) {
    const box = state.dom.tagCatalogBox;
    if (!box) return;
    box.textContent = "";
    const catalog = state.catalog;
    if (!catalog) return;

    const typeTags = catalog.tags.filter((tag) => Number(tag.type) === state.tagType);
    const query = state.tagQuery.trim().toLowerCase();
    if (query) {
      const hits = catalog.tags.filter(
        (tag) => Number(tag.id) > 0 && String(tag.name || "").toLowerCase().includes(query)
      );
      const section = el("div", "lib-tag-section");
      section.appendChild(el("div", "lib-tag-section-title", hits.length ? `搜索结果 · ${hits.length}` : "没有匹配的标签"));
      const wrap = el("div", "lib-tag-cloud");
      for (const tag of hits.slice(0, 200)) wrap.appendChild(tagChip(ctx, state, tag));
      section.appendChild(wrap);
      box.appendChild(section);
      return;
    }

    const roots = typeTags.filter((tag) => !Number(tag.parent));
    for (const root of roots) {
      const children = typeTags.filter((tag) => Number(tag.parent) === Number(root.id) && Number(tag.id) > 0);
      if (!children.length) {
        if (Number(root.id) <= 0) continue;
        const lone = el("div", "lib-tag-section lone");
        const wrap = el("div", "lib-tag-cloud");
        wrap.appendChild(tagChip(ctx, state, root));
        lone.appendChild(wrap);
        box.appendChild(lone);
        continue;
      }
      const section = el("div", "lib-tag-section");
      section.appendChild(el("div", "lib-tag-section-title", root.name));
      const wrap = el("div", "lib-tag-cloud");
      for (const tag of children) wrap.appendChild(tagChip(ctx, state, tag));
      section.appendChild(wrap);
      box.appendChild(section);
    }
    if (!box.childElementCount) box.appendChild(el("div", "lib-tag-empty", "这个分类暂时没有可选标签"));
  }
  export function renderTagSelected(ctx, state) {
    const box = state.dom.tagSelected;
    if (!box) return;
    box.textContent = "";
    box.appendChild(el("div", "lib-tag-selected-title", `已选标签（${state.tagDraft.size}）`));
    if (!state.tagDraft.size) {
      box.appendChild(el("div", "lib-tag-empty", "还没有选择标签"));
      return;
    }
    const wrap = el("div", "lib-tag-selected-list");
    for (const id of state.tagDraft) {
      const tag = catalogTag(id);
      const chip = el("button", "lib-sel-chip");
      chip.type = "button";
      chip.appendChild(document.createTextNode(tag ? tag.name : "#" + id));
      const x = el("span", "lib-sel-x");
      x.innerHTML = icon("close");
      chip.appendChild(x);
      chip.title = "移除";
      chip.addEventListener("click", () => {
        state.tagDraft.delete(Number(id));
        ctx.api.renderTagModal(ctx, state);
      });
      wrap.appendChild(chip);
    }
    box.appendChild(wrap);
  }
  export function renderTagStatus(ctx, state) {
    const status = state.dom.tagStatus;
    if (!status) return;
    status.textContent = "";
    if (state.catalogLoading) {
      status.textContent = "正在加载标签目录…";
      status.hidden = false;
      return;
    }
    if (!state.catalog && getTagCatalogError()) {
      status.hidden = false;
      status.appendChild(el("span", "", getTagCatalogError()));
      const retry = el("button", "lib-tag-retry", "重试");
      retry.type = "button";
      retry.addEventListener("click", () => ctx.api.loadTagCatalog(ctx, state, true));
      status.appendChild(retry);
      return;
    }
    status.hidden = true;
  }
