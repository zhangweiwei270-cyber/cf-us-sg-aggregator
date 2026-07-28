// priority 越大越优先。
// country:
//   "US" / "SG" = 该源强制归类
//   "AUTO"      = 根据每条记录中的 US/SG、城市/Colo 标签自动判断
//
// 建议只放“公开发布的候选列表”，不要在 Worker 中做大规模端口扫描。

export const SOURCES = [
  {
    name: "Gslege-US",
    url: "https://bestcf.pages.dev/gslege/US.txt",
    country: "US",
    priority: 100
  },
  {
    name: "Gslege-SG",
    url: "https://bestcf.pages.dev/gslege/SG.txt",
    country: "SG",
    priority: 100
  },
  {
    name: "S5-US",
    url: "https://bestcf.pages.dev/s5gy/us.txt",
    country: "US",
    priority: 95
  },
  {
    name: "S5-SG",
    url: "https://bestcf.pages.dev/s5gy/sg.txt",
    country: "SG",
    priority: 95
  },
  {
    name: "Mia",
    url: "https://bestcf.pages.dev/xinyitang3/ipv4.txt",
    country: "AUTO",
    priority: 90
  },
  {
    name: "Yuanxiawan",
    url: "https://raw.githubusercontent.com/yuanxiawan/cfipv4db/refs/heads/main/cfip.txt",
    country: "AUTO",
    priority: 90
  },
  {
    name: "WeTest",
    url: "https://bestcf.pages.dev/wetest/ipv4.txt",
    country: "AUTO",
    priority: 85
  },
  {
    name: "MingYu-IPDB",
    url: "https://raw.githubusercontent.com/ymyuuu/IPDB/refs/heads/main/BestCF/bestcfv4.txt",
    country: "AUTO",
    priority: 80
  },
  {
    name: "SS-Mobile",
    url: "https://raw.githubusercontent.com/svip-s/cloudflare_ip/refs/heads/main/best_ips.txt",
    country: "AUTO",
    priority: 75
  }
];
