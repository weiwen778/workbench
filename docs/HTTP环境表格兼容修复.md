# HTTP 环境表格兼容修复

公网 HTTP 地址不提供 crypto.randomUUID，而 localhost HTTP 被浏览器视作可信环境。此前只在 localhost 测试，遗漏了这个环境差异，导致工作簿初始化、记录事务和虚拟表编辑失败。

统一采用 crypto.getRandomValues 生成符合 UUID v4 格式的标识，用于界面对象和幂等请求键，不用于身份凭证。替换全部业务代码中的 randomUUID 直接调用。

新增 e2e/http-origin.mjs：通过 Chrome DNS 映射访问非 localhost 的 HTTP 域名，断言 isSecureContext 为 false、randomUUID 不可用，验证记录编辑、撤销、原表快照初始化保存、工作簿刷新与虚拟表来源生成。生产构建及该回归通过。
