<template>
  <transition name="fade">
    <div v-if="store.visible" class="backdrop">
      <div
        ref="dialog"
        class="updater-window"
        role="dialog"
        aria-modal="true"
        aria-label="Client update"
        tabindex="-1"
        @keydown.esc="close"
        @keydown.tab="trapFocus"
      >
        <div class="updater-overflow">
          <div
            v-loading="loading"
            element-loading-background="transparent"
            element-loading-text="Checking for updates…"
            element-loading-custom-class="loading-update-check"
            v-if="store.status === 'checking'"
            class="updater-text"
          ></div>
          <div
            v-else-if="store.status === 'not-available'"
            class="updater-text"
          >
            <p>You are up-to-date.</p>
            <p v-if="store.payload?.version" class="latest-version">
              Latest version: {{ store.payload.version }}
            </p>
            <section
              v-if="store.payload?.releaseNotes"
              class="release-notes-section"
            >
              <h3>Latest release notes</h3>
              <pre class="release-notes">{{ store.payload.releaseNotes }}</pre>
            </section>
          </div>
          <div
            v-else-if="store.status === 'available' && store.payload?.version"
            class="updater-text"
          >
            <p>
              Update
              <strong class="current-version-inline">{{
                store.payload.version
              }}</strong>
              is available!
            </p>
            <section
              v-if="store.payload?.releaseNotes"
              class="release-notes-section"
            >
              <h3>Release notes</h3>
              <pre class="release-notes">{{ store.payload.releaseNotes }}</pre>
            </section>
          </div>
          <div v-else-if="store.status === 'available'" class="updater-text">
            An update is available!
          </div>
          <div v-else-if="store.status === 'progress'" class="updater-text">
            Downloading update {{ store.targetVersion }}…
            <el-progress
              :text-inside="true"
              :stroke-width="24"
              :percentage="Number((store.payload.percent ?? 0).toFixed(1))"
              :color="colorset"
            >
            </el-progress>
          </div>
          <div v-else-if="store.status === 'downloaded'" class="updater-text">
            Update {{ store.targetVersion }} is ready to install.
          </div>
          <div
            v-loading="loading"
            element-loading-background="transparent"
            :element-loading-text="
              store.targetVersion
                ? `Installing update ${store.targetVersion}…`
                : 'Installing update…'
            "
            element-loading-custom-class="loading-update-check"
            v-if="store.status === 'installing'"
            class="updater-text"
          ></div>
          <div v-else-if="store.status === 'error'" class="updater-text">
            Error : {{ store.payload.message }}
          </div>
        </div>
        <div class="dialog-footer">
          <div class="updater-current-version">
            <template v-if="store.status === 'installing'">
              {{
                store.targetVersion
                  ? `Updating to VE Foundry Client ${store.targetVersion}`
                  : "Updating VE Foundry Client"
              }}
            </template>
            <template v-else>Installed version: {{ currentVersion }}</template>
            <div
              v-if="store.status !== 'installing'"
              class="updater-process-versions"
            >
              Node.js {{ versions.node }}, Chromium {{ versions.chrome }},
              Electron
              {{ versions.electron }}
            </div>
          </div>
          <label
            v-if="store.status === 'available' && store.targetVersion"
            class="updater-dismiss-version"
          >
            <input
              v-model="dontNotify"
              type="checkbox"
              :disabled="savingPreference"
            />
            Don't notify me of this version again
          </label>
          <p
            v-if="preferenceError"
            class="updater-preference-error"
            role="alert"
          >
            {{ preferenceError }}
          </p>
          <div class="updater-buttons">
            <button
              class="updater-button"
              v-if="store.status === 'available'"
              :disabled="savingPreference"
              @click="updateNow"
            >
              Update now
            </button>
            <button
              class="updater-button"
              v-if="store.status === 'downloaded'"
              @click="install"
            >
              Install
            </button>
            <button
              v-if="
                store.status !== 'available' && store.status !== 'installing'
              "
              class="updater-button"
              @click="openLatest"
            >
              Open GitHub
            </button>
            <button
              v-if="store.status !== 'installing'"
              class="updater-button"
              :disabled="savingPreference"
              @click="close"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { useUpdaterStore } from "../stores/updater";
import { ref, onMounted, reactive, watch, nextTick } from "vue";

const currentVersion = ref<string>("");
interface Versions {
  chrome: string;
  node: string;
  electron: string;
}

const versions = reactive<Partial<Versions>>({});
const loading = ref(true);
const colorset = ref("var(--color-accent)");
const dialog = ref<HTMLElement>();
const ignoredVersion = ref("");
const dontNotify = ref(false);
const savingPreference = ref(false);
const preferenceError = ref("");
let previousFocus: HTMLElement | null = null;

// Fetch the version when the modal mounts
onMounted(async () => {
  try {
    currentVersion.value = await window.api.appVersion();
    Object.assign(versions, window.api.versions);
    ignoredVersion.value =
      (await window.api.localAppConfig()).ignoredUpdateVersion ?? "";
  } catch (e) {
    console.warn("Could not fetch app version:", e);
  }
});

const store = useUpdaterStore();

watch([() => store.targetVersion, ignoredVersion], () => {
  dontNotify.value =
    !!store.targetVersion && store.targetVersion === ignoredVersion.value;
});

watch(
  () => store.visible,
  async (visible) => {
    preferenceError.value = "";
    if (visible) {
      previousFocus = document.activeElement as HTMLElement | null;
      await nextTick();
      dialog.value?.focus();
    } else {
      previousFocus?.focus();
    }
  },
);

function trapFocus(event: KeyboardEvent) {
  const controls = Array.from(
    dialog.value?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled)",
    ) ?? [],
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (!first) {
    event.preventDefault();
    return;
  }
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      document.activeElement === dialog.value)
  ) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function savePreference() {
  if (store.status !== "available" || !store.targetVersion) return true;
  const version = dontNotify.value ? store.targetVersion : "";
  if (version === ignoredVersion.value) return true;
  savingPreference.value = true;
  preferenceError.value = "";
  try {
    await window.api.saveAppConfig({ ignoredUpdateVersion: version });
    ignoredVersion.value = version;
    return true;
  } catch (error) {
    console.warn("Could not save update notification preference:", error);
    preferenceError.value = "Could not save your preference. Please try again.";
    return false;
  } finally {
    savingPreference.value = false;
  }
}

async function close() {
  if (store.status === "installing" || savingPreference.value) return;
  if (await savePreference()) store.close();
}

async function updateNow() {
  if (savingPreference.value || !(await savePreference())) return;
  window.api.downloadUpdate();
}

function install() {
  window.api.installUpdate();
}

function openLatest() {
  window.api.openExternal(
    "https://github.com/Silvestrae/ve-foundry-client/releases/latest",
  );
}
</script>
