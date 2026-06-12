// Help surface for `od design-systems`. Kept pure and separate from cli.ts so a
// test can assert the advertised subcommands without spawning the CLI or
// stubbing process.exit / console.log.

export const DESIGN_SYSTEMS_USAGE = `Usage:
  od design-systems list --visibility all|approved  List design systems.
  od design-systems show <id>                  Print one entry.
  od design-systems readiness <id>             Print readiness gates.
  od design-systems requests list              List DesignOps requests.
  od design-systems requests show <id>         Print one DesignOps request.
  od design-systems requests create            Create a DesignOps request.
  od design-systems requests update <id>       Update a DesignOps request.
  od design-systems rename <id> --title <new>  Rename an editable design system.
  od design-systems export-static <id>         Export a static HTML package.
  od design-systems import-local <path>        Import a local project.
  od design-systems import-github <url>        Import a public GitHub repo.
  od design-systems import-shadcn <reference>  Import a shadcn registry item.
  od design-systems rebuild-token-contract <id>  Start a token contract rebuild review.`;

// `help`, `--help`, and `-h` all route to the usage text above. Without the
// flag forms, `od design-systems --help` falls through to the generic library
// list, which only advertises `list` and `show` and never mentions `rename`.
export function isDesignSystemsHelpArg(arg: string | undefined): boolean {
  return arg === 'help' || arg === '--help' || arg === '-h';
}
