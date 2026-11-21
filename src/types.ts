// モジュール間で共有する最小の型。実サーバーなしのテストで差し替えられるようにする
export type Runner = { command(cmd: string): Promise<string> };
