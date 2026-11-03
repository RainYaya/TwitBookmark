export interface KeymapProps {
  onClose: () => void;
}

export const KEY_BINDINGS: Array<[string, string]> = [
  ['?', '键位帮助'],
  ['/', '搜索'],
  ['g t', '去推特流'],
  ['g l', '去库'],
  ['g s', '去设置'],
  ['j / k', '下一条 / 上一条'],
  ['x', '勾选「看过」；库里是多选'],
  ['c', '已消化'],
  ['s / e', '稍后 / 备查'],
  ['d', '移除（可撤销）'],
  ['t', '打标签'],
  ['o / Enter', '打开原链接'],
  ['u', '撤销上一步'],
  ['Esc', '关闭弹层 / 退出模式'],
];

export function Keymap({ onClose }: KeymapProps) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal keymap"
        role="dialog"
        aria-label="键位帮助"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2>键位</h2>
        <table>
          <tbody>
            {KEY_BINDINGS.map(([key, action]) => (
              <tr key={key}>
                <td>
                  <kbd>{key}</kbd>
                </td>
                <td>{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
