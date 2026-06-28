/// <reference types="mdast" />
import { h } from "hastscript";

/**
 * Creates a URL Card component.
 *
 * @param {Object} properties - The properties of the component.
 * @param {string} properties.href - The URL to display.
 * @param {import('mdast').RootContent[]} children - The children elements of the component.
 * @returns {import('mdast').Parent} The created URL Card component.
 */
export function UrlCardComponent(properties, children) {
	if (Array.isArray(children) && children.length !== 0)
		return h("div", { class: "hidden" }, [
			'Invalid directive. ("url" directive must be leaf type "::url{href="https://example.com"}")',
		]);

	if (!properties.href)
		return h(
			"div",
			{ class: "hidden" },
			'Invalid URL. ("href" attribute must be provided)',
		);

	const url = properties.href;
	const cardUuid = `UC${Math.random().toString(36).slice(-6)}`; // Collisions are not important

	const hasStaticTitle = !!properties.title;
	const titleVal = properties.title || "Loading...";
	const descVal = properties.desc || properties.description || "Waiting for api.microlink.io...";
	const faviconUrl = properties.logo || properties.favicon;
	const imageUrl = properties.image || properties.cover;

	const nImage = h(`div#${cardUuid}-image`, { 
		class: "uc-image",
		style: imageUrl && hasStaticTitle ? `background-image: url(${imageUrl});` : undefined
	});

	const nTitle = h("div", { class: "uc-titlebar" }, [
		h("div", { class: "uc-titlebar-left" }, [
			h(`div#${cardUuid}-favicon`, { 
				class: "uc-favicon",
				style: faviconUrl && hasStaticTitle ? `background-image: url(${faviconUrl}); background-color: transparent;` : (hasStaticTitle ? "display: none;" : undefined)
			}),
			h("div", { class: "uc-domain" }, new URL(url).hostname),
		]),
	]);

	const nDescription = h(
		`div#${cardUuid}-description`,
		{ class: "uc-description" },
		descVal,
	);

	const nTitleText = h(
		`div#${cardUuid}-title`,
		{ class: "uc-title-text" },
		titleVal,
	);

	let nScript = null;
	let containerClass = "uc-container";
	let cardClass = "card-url fetch-waiting no-styling";

	if (hasStaticTitle) {
		cardClass = "card-url no-styling";
		if (!imageUrl) {
			containerClass += " no-image";
		}
	} else {
		nScript = h(
			`script#${cardUuid}-script`,
			{ type: "text/javascript", defer: true },
			`
          (function() {
            const url = "${url}";
            const uuid = "${cardUuid}";
            const cacheKey = "uc-cache-" + btoa(url).replace(/=/g, '');
            const cached = localStorage.getItem(cacheKey);
            
            function renderCard(meta) {
              document.getElementById(uuid + '-title').innerText = meta.title || url;
              document.getElementById(uuid + '-description').innerText = meta.description || "No description available";
              
              const faviconEl = document.getElementById(uuid + '-favicon');
              if (meta.logo) {
                faviconEl.style.backgroundImage = 'url(' + meta.logo + ')';
                faviconEl.style.backgroundColor = 'transparent';
              } else {
                faviconEl.style.display = 'none';
              }

              const imageEl = document.getElementById(uuid + '-image');
              if (meta.image) {
                imageEl.style.backgroundImage = 'url(' + meta.image + ')';
              } else {
                imageEl.style.display = 'none';
                document.getElementById(uuid + '-container').classList.add('no-image');
              }
              document.getElementById(uuid + '-card').classList.remove("fetch-waiting");
            }

            if (cached) {
              try {
                const meta = JSON.parse(cached);
                if (Date.now() - meta.time < 7 * 24 * 60 * 60 * 1000) {
                  renderCard(meta.data);
                  console.log("[URL-CARD] Loaded from localStorage cache for " + url);
                  return;
                }
              } catch(e) {}
            }

            window.urlCardPromises = window.urlCardPromises || {};
            if (!window.urlCardPromises[url]) {
              window.urlCardPromises[url] = fetch('https://api.microlink.io?url=' + encodeURIComponent(url))
                .then(response => {
                  if (!response.ok) throw new Error('API response error');
                  return response.json();
                })
                .then(data => {
                  if (data.status === 'success') {
                    const metaData = {
                      title: data.data.title,
                      description: data.data.description,
                      logo: data.data.logo?.url,
                      image: data.data.image?.url
                    };
                    localStorage.setItem(cacheKey, JSON.stringify({
                      time: Date.now(),
                      data: metaData
                    }));
                    return metaData;
                  }
                  throw new Error('Microlink failed');
                });
            }

            window.urlCardPromises[url].then(meta => {
              renderCard(meta);
              console.log("[URL-CARD] Fetched and rendered for " + url);
            }).catch(err => {
              const c = document.getElementById(uuid + '-card');
              c?.classList.add("fetch-error");
              document.getElementById(uuid + '-title').innerText = "Error loading preview";
              document.getElementById(uuid + '-description').innerText = "Failed to fetch metadata for " + url;
              console.warn("[URL-CARD] Error loading card for " + url, err);
            });
          })();
        `,
		);
	}

	const childrenList = [
		h(`div#${cardUuid}-container`, { class: containerClass }, [
			h("div", { class: "uc-content" }, [nTitle, nTitleText, nDescription]),
			nImage,
		])
	];
	if (nScript) {
		childrenList.push(nScript);
	}

	return h(
		`a#${cardUuid}-card`,
		{
			class: cardClass,
			href: url,
			target: "_blank",
			url,
		},
		childrenList,
	);
}
