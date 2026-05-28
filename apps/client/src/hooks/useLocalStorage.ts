import { useState, useEffect, Dispatch, SetStateAction } from "react";
import { log } from "@/utils/logger";

/**
 * @function useLocalStorage
 * @description 自定义 Hook，用于在 localStorage 中存储和获取数据
 * @template T
 * @param {string} key - localStorage 的键名
 * @param {T} initialValue - 初始值
 * @returns {[T, Dispatch<SetStateAction<T>>]} - 状态值和设置状态的函数
 */
function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  // 使用函数式更新，确保只在组件首次渲染时执行一次 localStorage 读取操作
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item) {
        const parsedItem: unknown = JSON.parse(item);
        // 如果解析出的项是一个空数组，则返回初始值
        if (Array.isArray(parsedItem) && parsedItem.length === 0) {
          return initialValue;
        }
        return parsedItem as T;
      }
      return initialValue;
    } catch (error) {
      log.error(`Failed to read from localStorage: ${String(error)}`);
      return initialValue;
    }
  });

  // 当 storedValue 或 key 发生变化时，将新值存入 localStorage
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(storedValue));
    } catch (error) {
      log.error(`Failed to write to localStorage: ${String(error)}`);
    }
  }, [key, storedValue]);

  return [storedValue, setStoredValue];
}

export default useLocalStorage;
