const baseUrl = "https://umami.yaoxi.cloud";
const shareId = "011bd980-e5d9-44e5-b1f6-4dc30a9b0e83";
const currentTimestamp = Date.now();

async function test() {
    const resShare = await fetch(`${baseUrl}/api/share/${shareId}`);
    const shareData = await resShare.json();
    const { websiteId, token } = shareData;
    
    // Test /stats with url filter
    const params = new URLSearchParams({
        startAt: 0,
        endAt: currentTimestamp,
        url: "/posts/1-hello-world/",
        timezone: "Asia/Shanghai"
    });
    const statsUrl = `${baseUrl}/api/websites/${websiteId}/stats?${params.toString()}`;
    const resStats = await fetch(statsUrl, { headers: { "x-umami-share-token": token } });
    const stats = await resStats.json();
    console.log("Stats with URL filter:", stats);

    // Test /metrics with type=path
    const params2 = new URLSearchParams({
        startAt: 0,
        endAt: currentTimestamp,
        type: "path",
        limit: 5
    });
    const metricsUrl = `${baseUrl}/api/websites/${websiteId}/metrics?${params2.toString()}`;
    const resMetrics = await fetch(metricsUrl, { headers: { "x-umami-share-token": token } });
    const metrics = await resMetrics.json();
    console.log("Metrics type=path:", metrics.slice(0, 2));
}
test();
