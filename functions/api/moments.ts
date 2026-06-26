// @ts-nocheck
// Cloudflare Pages Functions API: /api/moments

export const onRequestGet = async (context) => {
  try {
    const { results } = await context.env.DB.prepare(
      "SELECT * FROM moments ORDER BY pinned DESC, published DESC"
    ).all();
    
    return new Response(JSON.stringify(results), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
};

export const onRequestPost = async (context) => {
  try {
    // 处理预检/跨域
    const authHeader = context.request.headers.get("Authorization");
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
    
    // 向 Google Tokeninfo 接口请求验证 idToken
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
    
    const payload = await verifyRes.json();
    
    // 验证 Client ID 匹配与邮箱地址
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
    
    // 验证通过，解析发表的动态数据
    const body = await context.request.json();
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
    
    // 生成唯一 ID
    const id = crypto.randomUUID();
    const published = new Date().toISOString();
    const author = "瑶曦网络科技官方"; // 默认为官方
    
    // 将媒体保存为 JSON 字符串
    const mediaStr = media ? JSON.stringify(media) : null;
    
    // 写入 D1 数据库
    await context.env.DB.prepare(
      "INSERT INTO moments (id, content, published, author, pinned, media) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(id, content.trim(), published, author, 0, mediaStr).run();
    
    return new Response(JSON.stringify({ success: true, id, published }), {
      status: 200,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
};
