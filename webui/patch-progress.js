// Patch step progress indicator: shows each step of the patch/unpatch flow
// with its status (pending/active/done/failed). Listens to stdout from the
// boot_patch.sh / boot_unpatch.sh to update steps in real time.
//
// The patch shell scripts print lines like:
//   "- Repacking boot image"
//   "- Flashing new boot image"
//   "- Successfully Patched!"
// We match these to a fixed step list and mark each as done when seen.

import { getString } from './language.js';
import { escapeHTML } from './utils.js';

const PATCH_STEPS = [
    { id: 'extract',   pattern: /(extract|find|locate).*boot|image/i,  label: 'patch_step_extract' },
    { id: 'validate',  pattern: /validat/i,                              label: 'patch_step_validate' },
    { id: 'patch',     pattern: /patch.*kernel|patching/i,               label: 'patch_step_patch' },
    { id: 'repack',    pattern: /repack/i,                              label: 'patch_step_repack' },
    { id: 'flash',     pattern: /flash|successfully/i,                   label: 'patch_step_flash' },
];

const UNPATCH_STEPS = [
    { id: 'extract',   pattern: /(extract|find|locate).*boot|image/i,  label: 'patch_step_extract' },
    { id: 'unpatch',   pattern: /unpatch/i,                             label: 'patch_step_unpatch' },
    { id: 'repack',    pattern: /repack/i,                              label: 'patch_step_repack' },
    { id: 'flash',     pattern: /flash|successfully/i,                   label: 'patch_step_flash' },
];

let container = null;
let currentSteps = [];
let stepEls = new Map();

/**
 * Render the step list into the given container element. Each step gets
 * an icon, a label, and a state class. Resets all steps to "pending".
 */
function renderSteps(steps) {
    if (!container) return;
    container.innerHTML = '';
    stepEls.clear();
    currentSteps = steps;

    steps.forEach((step, idx) => {
        const el = document.createElement('div');
        el.className = 'patch-step pending';
        el.dataset.step = step.id;
        el.innerHTML = `
            <div class="patch-step-icon">
                <md-circular-progress indeterminate style="--md-circular-progress-size:20px;display:none"></md-circular-progress>
                <span class="pending-dot">${idx + 1}</span>
            </div>
            <div class="patch-step-label">${escapeHTML(getString(step.label))}</div>
        `;
        stepEls.set(step.id, el);
        container.appendChild(el);
    });
}

/**
 * Update a step's visual state. We only ever move forward (pending -> active
 * -> done) so the UI never lies about what has already happened.
 */
function setStepState(stepId, state) {
    const el = stepEls.get(stepId);
    if (!el) return;
    el.classList.remove('pending', 'active', 'done', 'failed');
    el.classList.add(state);

    if (state === 'active') {
        const progress = el.querySelector('md-circular-progress');
        const dot = el.querySelector('.pending-dot');
        if (progress) progress.style.display = '';
        if (dot) dot.style.display = 'none';
    } else if (state === 'done' || state === 'failed') {
        const progress = el.querySelector('md-circular-progress');
        const dot = el.querySelector('.pending-dot');
        if (progress) progress.style.display = 'none';
        if (dot) {
            dot.textContent = state === 'done' ? '✓' : '✗';
            dot.classList.add(state === 'done' ? 'check' : 'cross');
        }
    }
}

/**
 * Process one stdout/stderr line from the patch script. Match against
 * each step's pattern; the first not-yet-active matching step becomes
 * active, the currently-active step becomes done. This way we don't have
 * to predict which step is next.
 */
function processLine(line) {
    // Find which step this line refers to.
    let matched = null;
    for (const step of currentSteps) {
        if (step.pattern.test(line)) {
            matched = step;
            break;
        }
    }
    if (!matched) return;

    // Mark this step active. If a previous step was active, mark it done.
    for (const [id, el] of stepEls) {
        if (el.classList.contains('active')) {
            if (id !== matched.id) setStepState(id, 'done');
        }
    }
    const el = stepEls.get(matched.id);
    if (el && el.classList.contains('pending')) {
        setStepState(matched.id, 'active');
    }
}

/**
 * Public API: start a new patch/unpatch flow. Pass the container element
 * and the type ('patch' or 'unpatch'). Returns helpers:
 *   onLine(line)        call for each stdout/stderr line
 *   finish(success)     call once the underlying process exits
 */
export function startProgress(type, containerEl) {
    container = containerEl;
    if (!container) return null;
    const steps = type === 'unpatch' ? UNPATCH_STEPS : PATCH_STEPS;
    renderSteps(steps);
    // Mark first step active immediately so the user sees something happen.
    if (steps.length > 0) setStepState(steps[0].id, 'active');
    return {
        onLine: processLine,
        finish(success) {
            // Mark any still-active step done/failed based on result.
            for (const [id, el] of stepEls) {
                if (el.classList.contains('active')) {
                    setStepState(id, success ? 'done' : 'failed');
                }
            }
            // If we never saw the last step, mark it done anyway on success.
            if (success && steps.length > 0) {
                const lastId = steps[steps.length - 1].id;
                const lastEl = stepEls.get(lastId);
                if (lastEl && !lastEl.classList.contains('done')) {
                    setStepState(lastId, 'done');
                }
            }
        },
    };
}

export function resetProgress() {
    if (container) container.innerHTML = '';
    stepEls.clear();
    currentSteps = [];
}
