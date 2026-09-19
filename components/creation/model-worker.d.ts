declare module '*?worker' {
  const worker: new () => Worker;
  export default worker;
}
