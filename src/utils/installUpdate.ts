import { app } from "electron";
import { spawn } from "child_process";
import { sendUpdateStatus } from "./updateStatus";

/**
 * Install DEB via DPKG, using a terminal
 */
export function installDebUpdate(debPath: string) {
  const shellCmd = `sudo dpkg -i "${debPath}" || sudo apt-get install -f -y`;

  // use a graphical terminal instead of pkexec
  const terminalCommand = [
    "x-terminal-emulator",
    "-e",
    `bash -c '${shellCmd}; read -p "Press Enter to close..."'`,
  ];

  const child = spawn(terminalCommand[0], terminalCommand.slice(1), {
    stdio: "inherit",
  });

  child.on("error", (err) => {
    console.error("Could not launch terminal to install update:", err);
    sendUpdateStatus("error");
  });

  child.on("close", (code) => {
    if (code !== 0) {
      console.error(`Could not install .deb file (exit code ${code})`);
      sendUpdateStatus("error");
      return;
    }
    app.relaunch();
    app.quit();
  });
}
