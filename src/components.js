/**
 * components.js — Vue component definitions.
 * Part of Darktide Scoreboard Tracker.
 */
(function () {
'use strict';
const App = window.App = window.App || {};

const MultiSelect = {
  props: {
    modelValue: { type: Array, required: true },
    displayLabel: { type: String, required: true },
    isOpen: Boolean,
    showAll: { type: Boolean, default: true },
    allValues: { type: Array, default: () => [] },
  },
  emits: ['update:modelValue', 'toggle', 'close'],
  data() { return { filterText: '' }; },
  watch: {
    isOpen(open) { if (!open) this.filterText = ''; },
  },
  methods: {
    selectAll() { this.$emit('update:modelValue', [...this.allValues]); },
    selectNone() { this.$emit('update:modelValue', []); },
    onFilter() {
      const q = this.filterText.toLowerCase();
      const items = this.$refs.slotContainer;
      if (!items) return;
      for (const el of items.children) {
        if (el.classList.contains('group-header') || el.tagName === 'LABEL') {
          const text = el.textContent.toLowerCase();
          el.style.display = !q || text.includes(q) ? '' : 'none';
        }
      }
    },
    focusFilter() {
      this.$nextTick(() => { this.$refs.filterInput?.focus(); });
    },
  },
  updated() { if (this.isOpen) this.onFilter(); },
  template: `
    <div class="multi-select" @click.stop>
      <div class="multi-select-trigger" tabindex="0" role="combobox"
        :aria-expanded="isOpen" aria-haspopup="listbox"
        @click="$emit('toggle'); focusFilter()"
        @keydown.enter.prevent="$emit('toggle'); focusFilter()"
        @keydown.escape="$emit('close')">
        {{ displayLabel }}
      </div>
      <div v-if="isOpen" class="multi-select-dropdown" role="listbox">
        <div class="ms-filter-wrap">
          <input ref="filterInput" class="ms-filter" type="text" v-model="filterText"
            @input="onFilter" placeholder="Filter..." @keydown.escape="$emit('close')">
          <span v-if="filterText" class="ms-filter-clear" @click="filterText = ''; onFilter(); $refs.filterInput.focus()">&times;</span>
        </div>
        <div class="ms-actions">
          <button v-if="showAll" class="btn-sm" @click.stop="selectAll()">All</button>
          <button class="btn-sm" @click.stop="selectNone()">None</button>
        </div>
        <div ref="slotContainer" class="ms-items"><slot></slot></div>
      </div>
    </div>
  `,
};

// Exports
App.MultiSelect = MultiSelect;
})();
