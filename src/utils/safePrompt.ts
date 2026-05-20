export function safePrompt(
  message: string,
  options?: {
    mode?: "confirm" | "alert";
    title?: string;
    details?: { label: string; value: string }[];
  },
): Promise<boolean> {
  return new Promise((resolve) => {
    const confirmBox = document.getElementById(
      "custom-confirm",
    ) as HTMLDivElement;
    const confirmText = document.getElementById("confirm-text")!;
    const yesButton = document.getElementById("confirm-yes")!;
    const noButton = document.getElementById("confirm-no")!;

    const mode = options?.mode ?? "confirm";

    confirmText.replaceChildren();
    if (options?.title || options?.details?.length) {
      if (options.title) {
        const title = document.createElement("h2");
        title.className = "confirm-title";
        title.textContent = options.title;
        confirmText.append(title);
      }

      if (message) {
        const body = document.createElement("p");
        body.className = "confirm-message";
        body.textContent = message;
        confirmText.append(body);
      }

      if (options.details?.length) {
        const details = document.createElement("dl");
        details.className = "confirm-details";
        for (const item of options.details) {
          const term = document.createElement("dt");
          const description = document.createElement("dd");
          term.textContent = item.label;
          description.textContent = item.value;
          details.append(term, description);
        }
        confirmText.append(details);
      }
    } else {
      confirmText.textContent = message;
    }

    confirmBox.classList.add("flex-display");
    void confirmBox.offsetWidth;
    confirmBox.classList.remove("hidden2");
    confirmBox.classList.remove("hidden-display");
    confirmBox.classList.add("show");

    if (mode === "alert") {
      noButton.classList.add("hidden2");
      noButton.classList.add("hidden-display");
      yesButton.textContent = "OK";
    } else {
      noButton.classList.remove("hidden2");
      noButton.classList.remove("hidden-display");
      yesButton.textContent = "Yes";
    }

    function cleanup() {
      confirmBox.classList.add("hidden2");

      const computedStyle = window.getComputedStyle(confirmBox);
      const transitionDuration =
        parseFloat(computedStyle.transitionDuration) || 0;

      if (transitionDuration > 0) {
        confirmBox.addEventListener("transitionend", function handler(e) {
          if (e.propertyName === "opacity") {
            confirmBox.classList.remove("show");
            confirmBox.classList.remove("flex-display");
            confirmBox.classList.add("hidden-display");
            confirmBox.removeEventListener("transitionend", handler);
          }
        });
      } else {
        confirmBox.classList.remove("show");
        confirmBox.classList.remove("flex-display");
        confirmBox.classList.add("hidden-display");
      }
      yesButton.removeEventListener("click", onYes);
      noButton.removeEventListener("click", onNo);
    }

    function onYes() {
      cleanup();
      resolve(true);
    }

    function onNo() {
      cleanup();
      resolve(false);
    }

    yesButton.addEventListener("click", onYes);
    noButton.addEventListener("click", onNo);
  });
}
