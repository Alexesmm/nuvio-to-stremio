# Library copy tool

A small website that copies your addons, library, watch progress and watched episodes from a Nuvio account to a Stremio account.

Unofficial. Not affiliated with or endorsed by Nuvio or Stremio.

## How your data is handled

- **There is no server.** It is a static site, and your browser talks directly to Nuvio's and Stremio's own APIs. You can check this in your browser's network tab.
- **Nothing is stored.** Sessions stay in the page's memory, and **Finish** signs you out of both. No cookies, no local storage, no analytics.
- **You review everything first.** No change happens before you press the button.
- **Nothing is removed from Stremio.** It only adds and updates, and your Nuvio account is only read. On a conflict in watch progress, the most recent one wins.

## What is copied

| Data | Copied? |
|---|---|
| Addons that work as Stremio addons, including keys in their links | Yes |
| Library | Yes |
| Watch progress | Yes, the latest position per title |
| Watched movies and episodes | Yes, for titles with IMDb ids |
| Nuvio plugins, settings, profiles, collections | No equivalent on Stremio |

Stremio accounts have no profiles, so the copy comes from one Nuvio profile.

**Titles with other ids.** A Nuvio item can use an id such as `tmdb:550`. The site looks in Stremio's public catalog for exactly the same name and year. If there is no certain match, the title is listed and skipped rather than risk adding the wrong one.

## Deploy on Vercel (free)

The site has no build step.

**From GitHub:** push this folder to a repository. In Vercel, choose **Add New > Project**, import it, keep the framework as **Other**, and deploy.

**From this folder:**

```powershell
npx vercel --prod
```

`vercel.json` sets the security headers, including a Content-Security-Policy that only allows the site's own scripts. Avoid "nuvio" or "stremio" in the project name, since those names belong to their owners and a site asking for passwords should not look official.

## Run and test locally

```powershell
npm test               # conversion rules
npx serve .            # open the site
```

## Limits

- It uses the public API Nuvio documents for third-party clients and the API the Stremio apps use. Either can change, and the hosted services have their own terms.
- Series watched marks use Cinemeta's episode list, so Kitsu titles keep their progress but not their per-episode watched marks.
- Accounts made with Google or Facebook can use the phone sign-in for Stremio. Nuvio sign-in is by email and password.

## License

GPL-3.0. See [LICENSE](LICENSE).
