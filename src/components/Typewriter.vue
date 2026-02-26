<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  phrases: {
    type: Array,
    default: () => ["欢迎来到我的博客", "探索技术与艺术", "代码构筑世界"]
  },
  interval: {
    type: Number,
    default: 30000 // 30秒
  }
});

const displayText = ref("");
const currentIndex = ref(0);
const isDeleting = ref(false);
const typeSpeed = 150; // 打字速度

let timer = null;
let switchTimer = null;

const type = () => {
  const fullText = props.phrases[currentIndex.value];
  
  if (isDeleting.value) {
    displayText.value = fullText.substring(0, displayText.value.length - 1);
  } else {
    displayText.value = fullText.substring(0, displayText.value.length + 1);
  }

  let currentSpeed = isDeleting.value ? typeSpeed / 2 : typeSpeed;

  // 完成输入
  if (!isDeleting.value && displayText.value === fullText) {
    // 等待 30 秒后开始删除并切换
    return; 
  } 
  
  // 完成删除
  if (isDeleting.value && displayText.value === "") {
    isDeleting.value = false;
    currentIndex.value = (currentIndex.value + 1) % props.phrases.length;
  }

  timer = setTimeout(type, currentSpeed);
};

// 每隔 30 秒触发一次切换逻辑
const triggerSwitch = () => {
  switchTimer = setInterval(() => {
    isDeleting.value = true;
    type();
  }, props.interval);
};

onMounted(() => {
  type(); // 初始打字
  triggerSwitch(); // 开启30秒循环
});

onUnmounted(() => {
  clearTimeout(timer);
  clearInterval(switchTimer);
});
</script>

<template>
  <div class="typewriter-container">
    <span class="gradient-text">{{ displayText }}</span>
    <span class="cursor">|</span>
  </div>
</template>

<style scoped>
.typewriter-container {
  font-weight: bold;
  font-size: 1.5rem;
  display: inline-block;
}

.gradient-text {
  /* 渐变色设置，你可以修改这里的颜色 */
  background: linear-gradient(45deg, #007cf0, #00dfd8, #ff0080, #007cf0);
  background-size: 200% auto;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: gradient-flow 5s linear infinite;
}

@keyframes gradient-flow {
  to { background-position: 200% center; }
}

.cursor {
  color: var(--primary);
  animation: blink 0.7s infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}
</style>