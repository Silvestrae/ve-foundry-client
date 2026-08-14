#!/bin/sh

set -e

app_executable="/opt/VE Foundry Client/ve-foundry-client"
command_link="/usr/bin/ve-foundry-client"

if [ -x "$app_executable" ]; then
  ln -sfn "$app_executable" "$command_link"
fi

exit 0
