package app

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

// Huapai documents its Seedance 2.5 video API under /hs with an Ark-compatible
// request. Keep this route confined to the exact Huapai model and endpoint.
func huapaiSeedance25NativeAdapter(ctx context.Context, input canvasGenerationInput) (canvasGenerationInput, protocol.Adapter, error) {
	if !isHuapaiSeedance25Video(input.Config) {
		return input, nil, fmt.Errorf("华湃 Seedance 2.5 原生协议不适用于此渠道")
	}
	protocolID := string(model.ChannelInterfaceVolcengineArkVideo)
	ctx = ensureOfficialProtocolAdapter(ctx, protocolID)
	adapter, ok := declarativeProtocolAdapterForContext(ctx, protocolID)
	if !ok {
		return input, nil, fmt.Errorf("华湃 Seedance 2.5 所需的方舟视频协议未安装")
	}
	base, err := url.Parse(strings.TrimSpace(input.Config.BaseURL))
	if err != nil {
		return input, nil, err
	}
	base.Path = "/hs"
	base.RawPath = ""
	input.Config.BaseURL = base.String()
	return input, adapter, nil
}
