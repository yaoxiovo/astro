interface Env {
  DB: D1Database;
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 处理 API 路由
    if (url.pathname === "/api/moments" || url.pathname === "/api/moments/") {
      const method = request.method.toUpperCase();

      if (method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "86400",
          },
        });
      }

      if (method === "GET") {
        try {
          const { results } = await env.DB.prepare(
            "SELECT * FROM moments ORDER BY pinned DESC, published DESC"
          ).all();
          
          return new Response(JSON.stringify(results), {
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
            },
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
      }

      if (method === "POST") {
        try {
          const authHeader = request.headers.get("Authorization");
          if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return new Response(JSON.stringify({ error: "Missing or invalid Authorization header" }), {
              status: 401,
              headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
          
          const idToken = authHeader.substring(7);
          
          const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
          const verifyRes = await fetch(verifyUrl);
          if (!verifyRes.ok) {
            return new Response(JSON.stringify({ error: "Failed to verify ID token with Google" }), {
              status: 401,
              headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
          
          const payload: any = await verifyRes.json();
          const expectedClientId = "218053004391-td65pfifej0a2rs85qbag13vns31l350.apps.googleusercontent.com";
          const allowedEmail = "yaoxiovo@gmail.com";
          
          if (payload.aud !== expectedClientId) {
            return new Response(JSON.stringify({ error: "Client ID mismatch" }), {
              status: 403,
              headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
          
          if (payload.email !== allowedEmail || (payload.email_verified !== "true" && payload.email_verified !== true)) {
            return new Response(JSON.stringify({ error: "Unauthorized user email" }), {
              status: 403,
              headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
          
          const body: any = await request.json();
          const { content, media } = body;
          
          if (!content || typeof content !== "string" || content.trim() === "") {
            return new Response(JSON.stringify({ error: "Content is required" }), {
              status: 400,
              headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
          
          const id = crypto.randomUUID();
          const published = new Date().toISOString();
          const author = "瑶曦网络科技官方";
          const mediaStr = media ? JSON.stringify(media) : null;
          
          await env.DB.prepare(
            "INSERT INTO moments (id, content, published, author, pinned, media) VALUES (?, ?, ?, ?, ?, ?)"
          ).bind(id, content.trim(), published, author, 0, mediaStr).run();
          
          return new Response(JSON.stringify({ success: true, id, published }), {
            status: 200,
            headers: { 
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
          
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
      }

      return new Response("Method not allowed", { status: 405 });
    }

    // 其它请求转发给 ASSETS (静态资源服务)
    return env.ASSETS.fetch(request);
  }
};
