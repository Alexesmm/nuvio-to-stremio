# Nuvio and Stremio account copy

Copy your addons, library, watch progress and watched titles between a Nuvio account and a Stremio account, in either direction, without installing anything.

Unofficial tool, not affiliated with or endorsed by Nuvio or Stremio.

## How it works

1. Choose the direction: Nuvio to Stremio, or Stremio to Nuvio.
2. Sign in to both accounts.
3. Review everything that will change. You can download a backup and leave out addons or the library.
4. Copy, then sign out.

## Your data

- **There is no server.** Your browser talks directly to Nuvio and Stremio, and your passwords go only to them. You can confirm this in your browser's network tab.
- **Nothing is stored.** Sessions stay in the page's memory and end when you finish. There are no cookies or analytics.
- **Nothing is removed.** The copy only adds and updates. The other account is only read. When both accounts have progress for the same title, the most recent one wins.

The backup file contains your addon links, which may include debrid keys, so keep it private.

## What is copied

| Data | Nuvio to Stremio | Stremio to Nuvio |
|---|---|---|
| Addons | Those that work as Stremio addons | All online addons |
| Library | Yes | Yes |
| Watch progress | Yes | Yes |
| Watched movies | Yes | Yes |
| Watched episodes | Series with IMDb ids | Series with IMDb ids |

Nuvio plugins, settings, profiles, collections and debrid settings kept only in the app are not copied. Stremio accounts have no profiles, so one Nuvio profile is used.

### Good to know

- **Titles with other ids.** Nuvio can list a title as `tmdb:550`, while Stremio uses IMDb ids. The site looks for exactly the same name and year in Stremio's catalog. If there is no certain match, the title is listed and skipped.
- **Titles already on Nuvio under another id.** When copying to Nuvio, a title with the same name is not added to the library again, unless the years show it is a different title. Its progress and watched marks are still copied under the Stremio id.
- **Accounts made with Google or Facebook** can sign in to Stremio with a phone. Nuvio sign-in uses email and password.
- **Shared addons.** If a Nuvio profile shares addons with the main profile, new addons go to the main profile.

## Development

A static site with no build step and no dependencies. Run the tests with `npm test`.

## License

[GPL-3.0](LICENSE)
