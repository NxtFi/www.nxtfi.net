export const wait = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function awsRetry<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  params = { maxRetries: 100 }
) {
  return async (...args: A): Promise<R | undefined> => {
    let retry
    let result
    let n = 0
    do {
      try {
        retry = false
        await wait(n++ * 100)
        result = await fn(...args)
      } catch (err: unknown) {
        if (n >= params.maxRetries) {
          console.log(`retried ${n} times`, err)
        }
        retry = true
      }
    } while (retry && n < params.maxRetries)
    return result
  }
}
