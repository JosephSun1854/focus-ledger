(function () {
  "use strict";

  const STORAGE_KEY = "focus-ledger-v1";
  const COLORS = ["#2f7569", "#d66f4e", "#4f70a8", "#9662a8", "#b28a35", "#4f8b52"];

  let state = loadState();
  let activeTimer = null;
  let filterMode = "all";
  let searchText = "";
  let confirmHandler = null;

  const $ = (selector) => document.querySelector(selector);

  function createId(prefix) {
    if (window.crypto && crypto.randomUUID) return prefix + "-" + crypto.randomUUID();
    return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function defaultState() {
    return {
      version: 1,
      categories: [],
      tasks: [],
      records: {},
      daily: {},
      dailyGoalMinutes: 120,
      theme: "light",
      ui: { categoryId: "all", taskId: "" }
    };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || !Array.isArray(parsed.categories) || !Array.isArray(parsed.tasks)) return defaultState();
      return {
        ...defaultState(),
        ...parsed,
        records: parsed.records || {},
        daily: parsed.daily || {},
        ui: { ...defaultState().ui, ...(parsed.ui || {}) }
      };
    } catch (error) {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function todayKey() {
    const date = new Date();
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function addDaily(seconds) {
    const key = todayKey();
    state.daily[key] = Math.max(0, Math.round((Number(state.daily[key]) || 0) + seconds));
  }

  function taskRecord(taskId) {
    if (!state.records[taskId]) {
      state.records[taskId] = { steps: {}, completed: false, completedAt: "", note: "" };
    }
    if (!state.records[taskId].steps) state.records[taskId].steps = {};
    return state.records[taskId];
  }

  function peekRecord(taskId) {
    return state.records[taskId] || { steps: {}, completed: false, completedAt: "", note: "" };
  }

  function categoryById(id) {
    return state.categories.find((category) => category.id === id);
  }

  function taskById(id) {
    return state.tasks.find((task) => task.id === id);
  }

  function stepById(task, stepId) {
    return task && task.steps.find((step) => step.id === stepId);
  }

  function plannedSeconds(task) {
    return task.steps.reduce((total, step) => total + Math.max(0, Number(step.targetMinutes) || 0) * 60, 0);
  }

  function liveStepSeconds(taskId, stepId) {
    const record = peekRecord(taskId);
    let seconds = Number(record.steps && record.steps[stepId]) || 0;
    if (activeTimer && activeTimer.taskId === taskId && activeTimer.stepId === stepId) {
      seconds += Math.max(0, Math.floor((Date.now() - activeTimer.startedAt) / 1000));
    }
    return seconds;
  }

  function actualSeconds(task) {
    return task.steps.reduce((total, step) => total + liveStepSeconds(task.id, step.id), 0);
  }

  function pad(number) {
    return String(number).padStart(2, "0");
  }

  function formatClock(seconds) {
    const safe = Math.max(0, Math.round(Number(seconds) || 0));
    return pad(Math.floor(safe / 3600)) + ":" + pad(Math.floor(safe % 3600 / 60)) + ":" + pad(safe % 60);
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor(safe % 3600 / 60);
    const secs = safe % 60;
    if (hours) return hours + "小时" + (minutes ? minutes + "分" : "");
    if (minutes) return minutes + "分" + (secs ? secs + "秒" : "");
    return secs + "秒";
  }

  function formatCompact(seconds) {
    const safe = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor(safe % 3600 / 60);
    if (hours) return hours + "小时" + (minutes ? minutes + "分" : "");
    if (safe < 60) return safe + "秒";
    return minutes + "分钟";
  }

  function parseClock(text) {
    const value = String(text).trim();
    if (!value) return 0;
    const parts = value.split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
    if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
    if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1]);
    if (parts.length === 1) return Math.round(parts[0] * 60);
    return null;
  }

  function scopedTasks() {
    if (state.ui.categoryId === "all") return state.tasks;
    return state.tasks.filter((task) => task.categoryId === state.ui.categoryId);
  }

  function expectedFinishDate(remainingSeconds) {
    if (remainingSeconds <= 0) return state.tasks.length ? "已完成" : "—";
    const perDay = Math.max(1, state.dailyGoalMinutes) * 60;
    const days = Math.max(1, Math.ceil(remainingSeconds / perDay));
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + days - 1);
    return (date.getMonth() + 1) + "月" + date.getDate() + "日";
  }

  function renderCategories() {
    const allCount = state.tasks.length;
    const chips = [
      '<div class="category-chip ' + (state.ui.categoryId === "all" ? "active" : "") + '" style="--chip-color:#697975">' +
        '<button class="category-main" type="button" data-category="all"><strong><span class="chip-dot"></span>全部任务</strong><small>' + allCount + ' 项</small></button>' +
      '</div>'
    ];

    state.categories.forEach((category) => {
      const tasks = state.tasks.filter((task) => task.categoryId === category.id);
      const done = tasks.filter((task) => peekRecord(task.id).completed).length;
      chips.push(
        '<div class="category-chip ' + (state.ui.categoryId === category.id ? "active" : "") + '" style="--chip-color:' + escapeHtml(category.color) + '">' +
          '<button class="category-main" type="button" data-category="' + category.id + '"><strong><span class="chip-dot"></span>' + escapeHtml(category.name) + '</strong><small>' + done + ' / ' + tasks.length + ' 完成</small></button>' +
          '<button class="category-edit" type="button" data-edit-category="' + category.id + '" aria-label="编辑' + escapeHtml(category.name) + '">•••</button>' +
        '</div>'
      );
    });
    $("#categoryStrip").innerHTML = chips.join("");
  }

  function renderMetrics() {
    const tasks = scopedTasks();
    const completed = tasks.filter((task) => peekRecord(task.id).completed).length;
    const totalPlanned = tasks.reduce((sum, task) => sum + plannedSeconds(task), 0);
    const totalActual = tasks.reduce((sum, task) => sum + actualSeconds(task), 0);
    const remaining = tasks.reduce((sum, task) => {
      if (peekRecord(task.id).completed) return sum;
      return sum + Math.max(0, plannedSeconds(task) - actualSeconds(task));
    }, 0);
    const today = Number(state.daily[todayKey()]) || 0;
    const completion = tasks.length ? Math.round(completed / tasks.length * 100) : 0;
    const todayProgress = Math.min(100, Math.round(today / (Math.max(1, state.dailyGoalMinutes) * 60) * 100));

    $("#metrics").innerHTML =
      '<article class="metric"><span class="metric-label">完成进度</span><strong>' + completed + ' / ' + tasks.length + '</strong><small>' + completion + '% 已完成</small><div class="progress-track"><div class="progress-fill" style="width:' + completion + '%"></div></div></article>' +
      '<article class="metric"><span class="metric-label">预计剩余</span><strong>' + formatCompact(remaining) + '</strong><small>按各环节目标时长计算</small></article>' +
      '<article class="metric"><span class="metric-label">预计完成</span><strong>' + expectedFinishDate(remaining) + '</strong><small>每日目标 ' + state.dailyGoalMinutes + ' 分钟</small></article>' +
      '<article class="metric"><span class="metric-label">今日专注</span><strong>' + formatCompact(today) + '</strong><small>累计记录 ' + formatCompact(totalActual) + ' / 计划 ' + formatCompact(totalPlanned) + '</small><div class="progress-track"><div class="progress-fill" style="width:' + todayProgress + '%"></div></div></article>';
  }

  function chooseTaskIfNeeded() {
    const visible = scopedTasks();
    if (!visible.some((task) => task.id === state.ui.taskId)) {
      const next = visible.find((task) => !peekRecord(task.id).completed) || visible[0];
      state.ui.taskId = next ? next.id : "";
    }
  }

  function renderTaskList() {
    const category = categoryById(state.ui.categoryId);
    $("#taskListTitle").textContent = category ? category.name : "全部任务";
    const tasks = scopedTasks().filter((task) => {
      const record = peekRecord(task.id);
      const statusMatches = filterMode === "all" || (filterMode === "done" && record.completed) || (filterMode === "todo" && !record.completed);
      const haystack = (task.name + " " + (task.description || "") + " " + (record.note || "")).toLowerCase();
      return statusMatches && (!searchText || haystack.includes(searchText));
    });

    if (!tasks.length) {
      $("#taskList").innerHTML = '<div class="empty-list">' + (state.tasks.length ? "没有符合条件的任务" : "先建立一个分类，再添加你的第一个任务") + '</div>';
      return;
    }

    $("#taskList").innerHTML = tasks.map((task) => {
      const record = peekRecord(task.id);
      const planned = plannedSeconds(task);
      const actual = actualSeconds(task);
      const difference = planned - actual;
      const category = categoryById(task.categoryId);
      const stateLabel = record.completed
        ? '<span class="task-state ' + (difference >= 0 ? "good" : "over") + '">' + (difference >= 0 ? "提前 " : "超出 ") + formatCompact(Math.abs(difference)) + '</span>'
        : '<span class="task-state">' + formatCompact(actual) + ' / ' + formatCompact(planned) + '</span>';
      return '<button class="task-item ' + (record.completed ? "done " : "") + (task.id === state.ui.taskId ? "active" : "") + '" type="button" data-task="' + task.id + '">' +
        '<span class="task-check">' + (record.completed ? "✓" : "") + '</span>' +
        '<span><span class="task-title">' + escapeHtml(task.name) + '</span><span class="task-meta">' + escapeHtml(category ? category.name : "未分类") + ' · ' + task.steps.length + ' 个环节</span></span>' + stateLabel + '</button>';
    }).join("");
  }

  function renderEmptyDetail() {
    const hasCategories = state.categories.length > 0;
    const title = hasCategories ? "添加一个属于你的任务" : "从一个分类开始";
    const copy = hasCategories
      ? "为任务安排自定义环节与目标时长，然后开始记录。"
      : "这里没有预设课程、固定流程或标准答案。先创建一个分类，再按你的方式组织时间。";
    const action = hasCategories ? "新建任务" : "新建分类";
    const id = hasCategories ? "emptyAddTask" : "emptyAddCategory";
    $("#detailPanel").innerHTML = '<div class="empty-state"><div class="empty-state-inner"><div class="empty-art">00:00</div><h2>' + title + '</h2><p>' + copy + '</p><button class="button button-primary" id="' + id + '" type="button">' + action + '</button></div></div>';
  }

  function timerCard(task, step) {
    const running = activeTimer && activeTimer.taskId === task.id && activeTimer.stepId === step.id;
    return '<article class="timer-card ' + (running ? "running" : "") + '" data-timer-card="' + step.id + '">' +
      '<div class="timer-label"><strong>' + escapeHtml(step.name) + '</strong><span>目标 ' + formatDuration(step.targetMinutes * 60) + '</span></div>' +
      '<input class="timer-input" data-time-step="' + step.id + '" value="' + formatClock(liveStepSeconds(task.id, step.id)) + '" aria-label="' + escapeHtml(step.name) + '实际用时">' +
      '<div class="timer-actions"><button class="start-button" type="button" data-action="toggle-timer" data-step="' + step.id + '">' + (running ? "暂停" : "开始") + '</button><button type="button" data-action="reset-step" data-step="' + step.id + '">归零</button></div>' +
    '</article>';
  }

  function renderDetail() {
    const task = taskById(state.ui.taskId);
    if (!task) {
      renderEmptyDetail();
      return;
    }
    const record = peekRecord(task.id);
    const category = categoryById(task.categoryId);
    const planned = plannedSeconds(task);
    const actual = actualSeconds(task);
    const difference = planned - actual;
    const progress = planned ? Math.min(999, Math.round(actual / planned * 100)) : 0;

    $("#detailPanel").innerHTML = '<div class="detail">' +
      '<div class="detail-top"><div><p class="eyebrow">' + escapeHtml(category ? category.name.toUpperCase() : "TASK") + '</p><h2>' + escapeHtml(task.name) + '</h2><p class="detail-description">' + escapeHtml(task.description || "没有任务说明。你可以随时编辑任务补充目标或完成标准。") + '</p><div class="badge-row"><span class="badge">' + task.steps.length + ' 个环节</span><span class="badge">计划 ' + formatDuration(planned) + '</span><span class="badge">已用 ' + formatDuration(actual) + '</span></div></div>' +
      '<div class="detail-menu"><button class="button button-ghost" type="button" data-action="edit-task">编辑</button></div></div>' +
      '<div class="timer-grid">' + task.steps.map((step) => timerCard(task, step)).join("") + '</div>' +
      '<div class="summary-grid"><div><span>计划用时</span><strong>' + formatDuration(planned) + '</strong></div><div><span>实际用时</span><strong id="detailActual">' + formatDuration(actual) + '</strong></div><div><span>' + (record.completed ? "最终差额" : "当前进度") + '</span><strong id="detailDifference" class="' + (difference >= 0 ? "good" : "over") + '">' + (record.completed ? (difference >= 0 ? "提前 " : "超出 ") + formatDuration(Math.abs(difference)) : progress + "%") + '</strong></div></div>' +
      '<label class="field-label notes-block"><span>任务记录</span><textarea class="field" id="taskNote" maxlength="2000" placeholder="记录成果、想法、复盘或下一步……">' + escapeHtml(record.note || "") + '</textarea></label>' +
      '<div class="detail-actions"><span class="autosave">所有修改自动保存在本机</span><button class="button ' + (record.completed ? "button-ghost" : "button-primary") + ' complete-button" type="button" data-action="toggle-complete">' + (record.completed ? "恢复为进行中" : "完成任务") + '</button></div>' +
    '</div>';
  }

  function renderAll() {
    document.documentElement.dataset.theme = state.theme;
    $("#dailyGoal").value = state.dailyGoalMinutes;
    chooseTaskIfNeeded();
    renderCategories();
    renderMetrics();
    renderTaskList();
    renderDetail();
    saveState();
  }

  function pauseTimer(shouldRender) {
    if (!activeTimer) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - activeTimer.startedAt) / 1000));
    const record = taskRecord(activeTimer.taskId);
    record.steps[activeTimer.stepId] = (Number(record.steps[activeTimer.stepId]) || 0) + elapsed;
    addDaily(elapsed);
    activeTimer = null;
    saveState();
    if (shouldRender !== false) renderAll();
  }

  function toggleTimer(stepId) {
    const task = taskById(state.ui.taskId);
    if (!task || !stepById(task, stepId)) return;
    if (activeTimer && activeTimer.taskId === task.id && activeTimer.stepId === stepId) {
      pauseTimer();
      return;
    }
    pauseTimer(false);
    taskRecord(task.id);
    activeTimer = { taskId: task.id, stepId, startedAt: Date.now(), notified: false };
    renderDetail();
  }

  function updateLive() {
    if (!activeTimer) return;
    const task = taskById(activeTimer.taskId);
    const step = stepById(task, activeTimer.stepId);
    if (!task || !step) {
      pauseTimer();
      return;
    }
    const seconds = liveStepSeconds(task.id, step.id);
    const input = document.querySelector('[data-time-step="' + CSS.escape(step.id) + '"]');
    if (input) input.value = formatClock(seconds);

    if (!activeTimer.notified && seconds >= step.targetMinutes * 60) {
      activeTimer.notified = true;
      showToast("“" + step.name + "”已达到目标时长");
      if (navigator.vibrate) navigator.vibrate([100, 80, 100]);
    }

    if (state.ui.taskId === task.id) {
      const actual = actualSeconds(task);
      const planned = plannedSeconds(task);
      const difference = planned - actual;
      const actualElement = $("#detailActual");
      const differenceElement = $("#detailDifference");
      if (actualElement) actualElement.textContent = formatDuration(actual);
      if (differenceElement && !peekRecord(task.id).completed) {
        differenceElement.textContent = (planned ? Math.min(999, Math.round(actual / planned * 100)) : 0) + "%";
        differenceElement.className = difference >= 0 ? "good" : "over";
      }
    }
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function openModal(selector) {
    $(selector).classList.add("show");
    document.body.style.overflow = "hidden";
    setTimeout(() => $(selector).querySelector("input:not([type=hidden]), textarea, select, button")?.focus(), 20);
  }

  function closeModal(modal) {
    (typeof modal === "string" ? $(modal) : modal).classList.remove("show");
    if (!document.querySelector(".modal.show")) document.body.style.overflow = "";
  }

  function openCategoryModal(categoryId) {
    const category = categoryById(categoryId);
    $("#categoryForm").reset();
    $("#categoryId").value = category ? category.id : "";
    $("#categoryName").value = category ? category.name : "";
    $("#categoryModalTitle").textContent = category ? "编辑分类" : "新建分类";
    $("#deleteCategoryButton").classList.toggle("hidden", !category);
    const chosen = category ? category.color : COLORS[state.categories.length % COLORS.length];
    $("#colorOptions").innerHTML = COLORS.map((color) => '<label class="color-choice" title="' + color + '"><input type="radio" name="categoryColor" value="' + color + '" ' + (color === chosen ? "checked" : "") + '><span style="--choice:' + color + '"></span></label>').join("");
    openModal("#categoryModal");
  }

  function addStepRow(name, targetMinutes, stepId) {
    const row = document.createElement("div");
    row.className = "step-row";
    row.dataset.stepId = stepId || createId("step");
    row.innerHTML = '<input class="field step-name" maxlength="40" required placeholder="环节名称"><input class="field step-minutes" type="number" min="1" max="10080" step="1" required placeholder="分钟" aria-label="目标分钟"><button class="remove-step" type="button" aria-label="删除环节">×</button>';
    row.querySelector(".step-name").value = name || "";
    row.querySelector(".step-minutes").value = targetMinutes || "";
    $("#stepEditor").appendChild(row);
  }

  function openTaskModal(taskId) {
    if (!state.categories.length) {
      showToast("请先创建一个分类");
      openCategoryModal();
      return;
    }
    const task = taskById(taskId);
    $("#taskForm").reset();
    $("#taskId").value = task ? task.id : "";
    $("#taskName").value = task ? task.name : "";
    $("#taskDescription").value = task ? task.description || "" : "";
    $("#taskCategory").innerHTML = state.categories.map((category) => '<option value="' + category.id + '">' + escapeHtml(category.name) + '</option>').join("");
    $("#taskCategory").value = task ? task.categoryId : (state.ui.categoryId !== "all" ? state.ui.categoryId : state.categories[0].id);
    $("#taskModalTitle").textContent = task ? "编辑任务" : "添加任务";
    $("#deleteTaskButton").classList.toggle("hidden", !task);
    $("#stepEditor").innerHTML = "";
    if (task) task.steps.forEach((step) => addStepRow(step.name, step.targetMinutes, step.id));
    else addStepRow("", "");
    openModal("#taskModal");
  }

  function askConfirm(title, message, onAccept) {
    $("#confirmTitle").textContent = title;
    $("#confirmMessage").textContent = message;
    confirmHandler = onAccept;
    openModal("#confirmModal");
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportJson() {
    pauseTimer(false);
    const payload = { ...state, exportedAt: new Date().toISOString() };
    downloadFile("focus-ledger-backup-" + todayKey() + ".json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    showToast("JSON 备份已导出");
  }

  function csvCell(value) {
    return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
  }

  function exportCsv() {
    pauseTimer(false);
    const rows = [["分类", "任务", "环节", "目标时长", "实际用时", "任务状态", "完成时间", "任务说明", "任务记录"]];
    state.tasks.forEach((task) => {
      const category = categoryById(task.categoryId);
      const record = peekRecord(task.id);
      task.steps.forEach((step) => {
        rows.push([
          category ? category.name : "",
          task.name,
          step.name,
          formatDuration(step.targetMinutes * 60),
          formatDuration(Number(record.steps && record.steps[step.id]) || 0),
          record.completed ? "已完成" : "进行中",
          record.completedAt ? new Date(record.completedAt).toLocaleString("zh-CN") : "",
          task.description || "",
          record.note || ""
        ]);
      });
    });
    const csv = "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadFile("focus-ledger-" + todayKey() + ".csv", csv, "text/csv;charset=utf-8");
    showToast("CSV 记录已导出");
  }

  async function importBackup(file) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !Array.isArray(parsed.categories) || !Array.isArray(parsed.tasks) || typeof parsed.records !== "object") throw new Error("invalid");
      pauseTimer(false);
      state = {
        ...defaultState(),
        ...parsed,
        categories: parsed.categories,
        tasks: parsed.tasks,
        records: parsed.records || {},
        daily: parsed.daily || {},
        ui: { ...defaultState().ui, ...(parsed.ui || {}) }
      };
      saveState();
      renderAll();
      showToast("备份已导入");
    } catch (error) {
      showToast("无法导入：文件格式不正确");
    } finally {
      $("#importInput").value = "";
    }
  }

  $("#categoryForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const id = $("#categoryId").value;
    const name = $("#categoryName").value.trim();
    const color = document.querySelector('input[name="categoryColor"]:checked')?.value || COLORS[0];
    if (!name) return;
    if (id) {
      const category = categoryById(id);
      if (category) Object.assign(category, { name, color });
    } else {
      const category = { id: createId("category"), name, color };
      state.categories.push(category);
      state.ui.categoryId = category.id;
    }
    closeModal("#categoryModal");
    renderAll();
    showToast(id ? "分类已更新" : "分类已创建");
  });

  $("#taskForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const id = $("#taskId").value;
    const name = $("#taskName").value.trim();
    const categoryId = $("#taskCategory").value;
    const description = $("#taskDescription").value.trim();
    const steps = Array.from(document.querySelectorAll("#stepEditor .step-row")).map((row) => ({
      id: row.dataset.stepId,
      name: row.querySelector(".step-name").value.trim(),
      targetMinutes: Math.round(Number(row.querySelector(".step-minutes").value))
    })).filter((step) => step.name && step.targetMinutes > 0);
    if (!name || !categoryId || !steps.length) {
      showToast("请填写任务名称，并至少保留一个有效环节");
      return;
    }
    if (id) {
      const task = taskById(id);
      if (task) Object.assign(task, { name, categoryId, description, steps });
    } else {
      const task = { id: createId("task"), name, categoryId, description, steps };
      state.tasks.push(task);
      state.ui.categoryId = categoryId;
      state.ui.taskId = task.id;
    }
    closeModal("#taskModal");
    renderAll();
    showToast(id ? "任务已更新" : "任务已创建");
  });

  document.addEventListener("click", (event) => {
    const categoryButton = event.target.closest("[data-category]");
    if (categoryButton) {
      pauseTimer(false);
      state.ui.categoryId = categoryButton.dataset.category;
      state.ui.taskId = "";
      renderAll();
      return;
    }
    const editCategory = event.target.closest("[data-edit-category]");
    if (editCategory) {
      openCategoryModal(editCategory.dataset.editCategory);
      return;
    }
    const taskButton = event.target.closest("[data-task]");
    if (taskButton) {
      pauseTimer(false);
      state.ui.taskId = taskButton.dataset.task;
      renderAll();
      return;
    }
    const action = event.target.closest("[data-action]");
    if (action) {
      const task = taskById(state.ui.taskId);
      if (action.dataset.action === "toggle-timer") toggleTimer(action.dataset.step);
      if (action.dataset.action === "reset-step" && task) {
        askConfirm("将本环节归零？", "这会清除该环节已经记录的时间。", () => {
          pauseTimer(false);
          const record = taskRecord(task.id);
          record.steps[action.dataset.step] = 0;
          renderAll();
          showToast("环节计时已归零");
        });
      }
      if (action.dataset.action === "edit-task" && task) openTaskModal(task.id);
      if (action.dataset.action === "toggle-complete" && task) {
        pauseTimer(false);
        const record = taskRecord(task.id);
        record.completed = !record.completed;
        record.completedAt = record.completed ? new Date().toISOString() : "";
        renderAll();
        showToast(record.completed ? "任务完成，做得好" : "任务已恢复为进行中");
      }
      return;
    }
    if (event.target.closest("[data-close-modal]")) {
      closeModal(event.target.closest(".modal"));
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-time-step]")) {
      const task = taskById(state.ui.taskId);
      if (!task) return;
      pauseTimer(false);
      const stepId = event.target.dataset.timeStep;
      const value = parseClock(event.target.value);
      if (value === null) {
        showToast("请输入 HH:MM:SS、MM:SS 或分钟数");
        renderDetail();
        return;
      }
      const record = taskRecord(task.id);
      record.steps[stepId] = value;
      renderAll();
      return;
    }
    if (event.target.id === "dailyGoal") {
      state.dailyGoalMinutes = Math.max(1, Math.min(1440, Math.round(Number(event.target.value) || 120)));
      renderMetrics();
      saveState();
    }
    if (event.target.id === "filterSelect") {
      filterMode = event.target.value;
      renderTaskList();
    }
    if (event.target.id === "importInput" && event.target.files[0]) importBackup(event.target.files[0]);
  });

  document.addEventListener("input", (event) => {
    if (event.target.id === "searchInput") {
      searchText = event.target.value.trim().toLowerCase();
      renderTaskList();
    }
    if (event.target.id === "taskNote") {
      taskRecord(state.ui.taskId).note = event.target.value;
      saveState();
    }
  });

  $("#addCategoryButton").addEventListener("click", () => openCategoryModal());
  $("#addTaskButton").addEventListener("click", () => openTaskModal());
  $("#addStepButton").addEventListener("click", () => addStepRow("", ""));
  $("#stepEditor").addEventListener("click", (event) => {
    const remove = event.target.closest(".remove-step");
    if (!remove) return;
    if (document.querySelectorAll("#stepEditor .step-row").length === 1) {
      showToast("一个任务至少需要一个环节");
      return;
    }
    remove.closest(".step-row").remove();
  });

  $("#deleteCategoryButton").addEventListener("click", () => {
    const id = $("#categoryId").value;
    const category = categoryById(id);
    if (!category) return;
    const count = state.tasks.filter((task) => task.categoryId === id).length;
    askConfirm("删除“" + category.name + "”？", "该分类下的 " + count + " 个任务及其记录也会一并删除。", () => {
      pauseTimer(false);
      const taskIds = new Set(state.tasks.filter((task) => task.categoryId === id).map((task) => task.id));
      state.tasks = state.tasks.filter((task) => task.categoryId !== id);
      taskIds.forEach((taskId) => delete state.records[taskId]);
      state.categories = state.categories.filter((item) => item.id !== id);
      state.ui.categoryId = "all";
      state.ui.taskId = "";
      closeModal("#categoryModal");
      renderAll();
      showToast("分类已删除");
    });
  });

  $("#deleteTaskButton").addEventListener("click", () => {
    const id = $("#taskId").value;
    const task = taskById(id);
    if (!task) return;
    askConfirm("删除“" + task.name + "”？", "该任务的所有计时和记录都会被删除。", () => {
      pauseTimer(false);
      state.tasks = state.tasks.filter((item) => item.id !== id);
      delete state.records[id];
      state.ui.taskId = "";
      closeModal("#taskModal");
      renderAll();
      showToast("任务已删除");
    });
  });

  $("#confirmCancel").addEventListener("click", () => {
    confirmHandler = null;
    closeModal("#confirmModal");
  });
  $("#confirmAccept").addEventListener("click", () => {
    const handler = confirmHandler;
    confirmHandler = null;
    closeModal("#confirmModal");
    if (handler) handler();
  });

  $("#themeButton").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = state.theme;
    saveState();
  });
  $("#exportCsvButton").addEventListener("click", exportCsv);
  $("#exportJsonButton").addEventListener("click", exportJson);
  $("#importButton").addEventListener("click", () => $("#importInput").click());

  document.addEventListener("click", (event) => {
    if (event.target.id === "emptyAddCategory") openCategoryModal();
    if (event.target.id === "emptyAddTask") openTaskModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const modal = document.querySelector(".modal.show");
      if (modal) closeModal(modal);
    }
  });

  window.addEventListener("beforeunload", () => pauseTimer(false));
  setInterval(updateLive, 500);
  setInterval(() => { if (activeTimer) renderMetrics(); }, 15000);
  renderAll();
})();
