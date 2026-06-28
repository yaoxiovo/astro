/// <reference types="mdast" />
import { h } from "hastscript";

/**
 * Creates a GitHub Card component.
 *
 * @param {Object} properties - The properties of the component.
 * @param {string} properties.repo - The GitHub repository in the format "owner/repo".
 * @param {import('mdast').RootContent[]} children - The children elements of the component.
 * @returns {import('mdast').Parent} The created GitHub Card component.
 */
export function GithubCardComponent(properties, children) {
	if (Array.isArray(children) && children.length !== 0)
		return h("div", { class: "hidden" }, [
			'Invalid directive. ("github" directive must be leaf type "::github{repo="owner/repo"}")',
		]);

	if (!properties.repo || !properties.repo.includes("/"))
		return h(
			"div",
			{ class: "hidden" },
			'Invalid repository. ("repo" attributte must be in the format "owner/repo")',
		);

	const repo = properties.repo;
	const cardUuid = `GC${Math.random().toString(36).slice(-6)}`; // Collisions are not important

	const hasStatic = !!properties.description;
	const descVal = properties.desc || properties.description || "Waiting for api.github.com...";
	const starsVal = properties.stars || "00K";
	const forksVal = properties.forks || "0K";
	const licenseVal = properties.license || "no-license";
	const languageVal = properties.language || "Waiting...";
	const avatarUrl = properties.avatar || properties.avatarUrl;

	const nAvatar = h(`div#${cardUuid}-avatar`, { 
		class: "gc-avatar",
		style: avatarUrl && hasStatic ? `background-image: url(${avatarUrl}); background-color: transparent;` : undefined
	});
	const nLanguage = h(
		`span#${cardUuid}-language`,
		{ class: "gc-language" },
		languageVal,
	);

	const nTitle = h("div", { class: "gc-titlebar" }, [
		h("div", { class: "gc-titlebar-left" }, [
			h("div", { class: "gc-owner" }, [
				nAvatar,
				h("div", { class: "gc-user" }, repo.split("/")[0]),
			]),
			h("div", { class: "gc-divider" }, "/"),
			h("div", { class: "gc-repo" }, repo.split("/")[1]),
		]),
		h("div", { class: "github-logo" }),
	]);

	const nDescription = h(
		`div#${cardUuid}-description`,
		{ class: "gc-description" },
		descVal,
	);

	const nStars = h(`div#${cardUuid}-stars`, { class: "gc-stars" }, starsVal);
	const nForks = h(`div#${cardUuid}-forks`, { class: "gc-forks" }, forksVal);
	const nLicense = h(`div#${cardUuid}-license`, { class: "gc-license" }, licenseVal);

	let nScript = null;
	let cardClass = "card-github fetch-waiting no-styling";

	if (hasStatic) {
		cardClass = "card-github no-styling";
	} else {
		nScript = h(
			`script#${cardUuid}-script`,
			{ type: "text/javascript", defer: true },
			`
          (function() {
            const repo = "${repo}";
            const uuid = "${cardUuid}";
            const cacheKey = "gc-cache-" + btoa(repo).replace(/=/g, '');
            const cached = localStorage.getItem(cacheKey);

            function renderCard(data) {
              document.getElementById(uuid + '-description').innerText = data.description || "Description not set";
              document.getElementById(uuid + '-language').innerText = data.language || "Unknown";
              document.getElementById(uuid + '-forks').innerText = data.forks;
              document.getElementById(uuid + '-stars').innerText = data.stars;
              document.getElementById(uuid + '-license').innerText = data.license || "no-license";
              const avatarEl = document.getElementById(uuid + '-avatar');
              if (data.avatar) {
                avatarEl.style.backgroundImage = 'url(' + data.avatar + ')';
                avatarEl.style.backgroundColor = 'transparent';
              }
              document.getElementById(uuid + '-card').classList.remove("fetch-waiting");
            }

            if (cached) {
              try {
                const meta = JSON.parse(cached);
                if (Date.now() - meta.time < 1 * 24 * 60 * 60 * 1000) {
                  renderCard(meta.data);
                  console.log("[GITHUB-CARD] Loaded from localStorage cache for " + repo);
                  return;
                }
              } catch(e) {}
            }

            window.githubCardPromises = window.githubCardPromises || {};
            if (!window.githubCardPromises[repo]) {
              window.githubCardPromises[repo] = fetch('https://api.github.com/repos/' + repo, { referrerPolicy: "no-referrer" })
                .then(response => {
                  if (!response.ok) throw new Error('GitHub API response error');
                  return response.json();
                })
                .then(data => {
                  const formattedForks = Intl.NumberFormat('en-us', { notation: "compact", maximumFractionDigits: 1 }).format(data.forks).replaceAll("\\u202f", '');
                  const formattedStars = Intl.NumberFormat('en-us', { notation: "compact", maximumFractionDigits: 1 }).format(data.stargazers_count).replaceAll("\\u202f", '');
                  const metaData = {
                    description: data.description?.replace(/:[a-zA-Z0-9_]+:/g, '') || "Description not set",
                    language: data.language,
                    forks: formattedForks,
                    stars: formattedStars,
                    license: data.license?.spdx_id || "no-license",
                    avatar: data.owner.avatar_url
                  };
                  localStorage.setItem(cacheKey, JSON.stringify({
                    time: Date.now(),
                    data: metaData
                  }));
                  return metaData;
                });
            }

            window.githubCardPromises[repo].then(data => {
              renderCard(data);
              console.log("[GITHUB-CARD] Fetched and rendered for " + repo);
            }).catch(err => {
              const c = document.getElementById(uuid + '-card');
              c?.classList.add("fetch-error");
              console.warn("[GITHUB-CARD] Error loading card for " + repo, err);
            });
          })();
        `,
		);
	}

	const childrenList = [
		nTitle,
		nDescription,
		h("div", { class: "gc-infobar" }, [nStars, nForks, nLicense, nLanguage])
	];
	if (nScript) {
		childrenList.push(nScript);
	}

	return h(
		`a#${cardUuid}-card`,
		{
			class: cardClass,
			href: `https://github.com/${repo}`,
			target: "_blank",
			repo,
		},
		childrenList,
	);
}
