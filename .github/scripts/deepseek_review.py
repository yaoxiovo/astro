import os
import json
import subprocess
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["DEEPSEEK_API_KEY"],
    base_url="https://api.deepseek.com"
)

event_name = os.environ.get("GITHUB_EVENT_NAME", "")
event_path = os.environ.get("GITHUB_EVENT_PATH", "")

event_payload = {}
if event_path and os.path.exists(event_path):
    with open(event_path, "r", encoding="utf-8") as f:
        event_payload = json.load(f)


def run_git_diff(diff_range):
    return subprocess.check_output(
        ["git", "diff", diff_range],
        text=True,
        errors="ignore"
    )


if event_name == "pull_request":
    base_sha = event_payload.get("pull_request", {}).get("base", {}).get("sha")
    head_sha = event_payload.get("pull_request", {}).get("head", {}).get("sha")
    if base_sha and head_sha:
        diff = run_git_diff(f"{base_sha}...{head_sha}")
    else:
        diff = subprocess.check_output(
            ["git", "diff", "HEAD~1..HEAD"],
            text=True,
            errors="ignore"
        )
elif event_name == "push":
    before_sha = event_payload.get("before")
    after_sha = event_payload.get("after") or os.environ.get("GITHUB_SHA", "HEAD")

    if before_sha and before_sha != "0000000000000000000000000000000000000000":
        diff = run_git_diff(f"{before_sha}..{after_sha}")
    else:
        try:
            parent_sha = subprocess.check_output(
                ["git", "rev-parse", f"{after_sha}^"],
                text=True
            ).strip()
            diff = run_git_diff(f"{parent_sha}..{after_sha}")
        except subprocess.CalledProcessError:
            diff = subprocess.check_output(
                ["git", "show", "--pretty=format:", after_sha],
                text=True,
                errors="ignore"
            )
else:
    diff = subprocess.check_output(
        ["git", "diff", "HEAD~1..HEAD"],
        text=True,
        errors="ignore"
    )

if not diff.strip():
    print("No code changes found.")
    exit(0)

prompt = f"""
你是一个严格的代码审查机器人。

请审查下面的 git diff，重点关注：
1. 真实 bug
2. 安全风险
3. 性能问题
4. 边界条件
5. 可维护性
6. 是否需要补测试

要求：
- 用中文输出
- 不要泛泛而谈
- 按严重程度排序
- 如果没有明显问题，直接说“未发现明显问题”

代码 diff：

{diff[:50000]}
"""

response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=[
        {"role": "system", "content": "你是资深代码审查工程师。"},
        {"role": "user", "content": prompt},
    ],
    stream=False,
)

review = response.choices[0].message.content

with open("deepseek_review.md", "w", encoding="utf-8") as f:
    f.write(review)

print(review)
