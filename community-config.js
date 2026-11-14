/* 社区的云端存储设置。
   两项都留空 = 本机模式：帖子只存在这台设备的浏览器里（演示时不依赖网络）。
   填上 Supabase 项目的地址和 anon key = 云端模式：所有人看到同一个社区。
   建表的 SQL 见《社区云端设置.md》。anon key 本来就是公开给网页用的，可以放在这里。 */
window.COMMUNITY_CONFIG = {
  supabaseUrl: '',   // 例：https://abcdefgh.supabase.co
  anonKey: ''
};
