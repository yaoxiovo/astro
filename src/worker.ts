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
          const id = url.searchParams.get("id");
          if (id) {
            // 查询单条动态
            const result = await env.DB.prepare(
              "SELECT * FROM moments WHERE id = ?"
            ).bind(id).first();
            
            if (!result) {
              return new Response(JSON.stringify({ error: "Moment not found" }), {
                status: 404,
                headers: { 
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*",
                },
              });
            }
            
            return new Response(JSON.stringify(result), {
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }

          // 查询全部动态
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
          const { content, media, author: reqAuthor, published: reqPublished } = body;
          
          if (!content || typeof content !== "string" || content.trim() === "") {
            return new Response(JSON.stringify({ error: "Content is required" }), {
              status: 400,
              headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
          
          // 笔名合法性限制与回退，只允许 "瑶曦" 或 "瑶曦网络科技官方"
          const author = (reqAuthor === "瑶曦" || reqAuthor === "瑶曦网络科技官方") 
            ? reqAuthor 
            : "瑶曦网络科技官方";
            
          // 自定义发布日期，如无或非法则用当前时间
          let published = new Date().toISOString();
          if (reqPublished) {
            try {
              published = new Date(reqPublished).toISOString();
            } catch (e) {}
          }
          
          const id = crypto.randomUUID();
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

    // 尝试拉取静态资源 (Astro 编译的 HTML 等)
    const response = await env.ASSETS.fetch(request);
    
    // 如果静态资源存在且正常返回，直接输出
    if (response.status !== 404) {
      return response;
    }
    
    // 如果静态资源 404，且符合新朋友圈动态的详情页模式: /moment/[id]
    const momentIdMatch = url.pathname.match(/^\/moment\/([^\/]+)\/?$/);
    if (momentIdMatch) {
      const momentId = momentIdMatch[1];
      
      // 内联请求朋友圈主页，作为框架骨架返回
      const tplUrl = new URL("/moments/", request.url);
      const tplResponse = await env.ASSETS.fetch(new Request(tplUrl));
      
      if (tplResponse.status === 200) {
        let html = await tplResponse.text();
        
        // 在 head 底部注入 window.singleMomentId 全局标记以告知客户端只渲染单条详情
        const injectScript = `<script>window.singleMomentId = "${momentId}";</script></head>`;
        html = html.replace("</head>", injectScript);
        
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8"
          }
        });
      }
    }

    // 默认返回 404
    return response;
  }
};
