#!/bin/sh

app_executable="/opt/VE Foundry Client/ve-foundry-client"
command_link="/usr/bin/ve-foundry-client"

case "${1:-}" in
  0 | remove | purge)
    if [ -L "$command_link" ] && [ "$(readlink "$command_link")" = "$app_executable" ]; then
      rm -f "$command_link"
    fi
    ;;
esac

exit 0
