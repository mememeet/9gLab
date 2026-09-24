package app

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestPublishLocalProviderResourcePreservesIdentityAndPrivateAccess(t *testing.T) {
	for _, failUpload := range []bool{false, true} {
		name := "success"
		if failUpload {
			name = "failed-upload"
		}
		t.Run(name, func(t *testing.T) {
			t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
			svc := newResourceTestService(t)
			t.Setenv("CANVAS_PUBLIC_BASE_URL", "")
			payload := "reference-image-content"
			resource := &model.Resource{ID: "image-1", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "users/owner/image/original.png", MimeType: "image/png", Size: int64(len(payload))}
			if err := svc.repo.CreateResource(resource); err != nil {
				t.Fatal(err)
			}
			localPath := filepath.Join(svc.dataDir, "resources", resource.ObjectKey)
			if err := writeLocalResourceObject(localPath, strings.NewReader(payload)); err != nil {
				t.Fatal(err)
			}
			puts := 0
			server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPut {
					t.Errorf("unexpected request: %s", r.Method)
					w.WriteHeader(400)
					return
				}
				puts++
				if r.Header.Get("x-oss-object-acl") != "private" {
					t.Error("upload must not inherit public bucket ACL")
				}
				canonical := "PUT\n\nimage/png\n" + r.Header.Get("Date") + "\nx-oss-object-acl:private\n/bucket" + r.URL.Path
				mac := hmac.New(sha1.New, []byte("test-secret"))
				_, _ = mac.Write([]byte(canonical))
				if r.Header.Get("Authorization") != "OSS test-id:"+base64.StdEncoding.EncodeToString(mac.Sum(nil)) {
					t.Error("ACL must be covered by OSS signature")
				}
				got, err := io.ReadAll(r.Body)
				if err != nil || string(got) != payload {
					t.Errorf("uploaded bytes differ: %v", err)
				}
				if failUpload {
					w.WriteHeader(403)
					return
				}
				w.Header().Set("ETag", "content-etag")
			}))
			listener, err := net.Listen("tcp", ":0")
			if err != nil {
				t.Fatal(err)
			}
			server.Listener = listener
			server.Start()
			defer server.Close()
			_, port, err := net.SplitHostPort(server.Listener.Addr().String())
			if err != nil {
				t.Fatal(err)
			}
			endpoint := "http://localhost:" + port
			_, err = svc.UpdateUserOSSSetting(&model.User{ID: "owner"}, OSSSettingRequest{Enabled: true, Provider: "aliyun", Endpoint: endpoint, Bucket: "bucket", PathPrefix: "9gtoken-assets/9glab", AccessKeyID: "test-id", AccessKeySecret: "test-secret", AllowPrivateProxy: true})
			if err != nil {
				t.Fatal(err)
			}
			media := providerMedia{StorageKey: "resource:image-1"}
			t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://canvas.example.com")
			media.URL, err = svc.publishLocalProviderResource("owner", resource, BadAuthRequest("local resource needs publication"))
			stored, readErr := svc.repo.ResourceForUser("owner", resource.ID)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if failUpload {
				if err == nil || stored.Provider != "local" || stored.ObjectKey != resource.ObjectKey {
					t.Fatalf("failed upload changed local resource: err=%v provider=%s key=%s", err, stored.Provider, stored.ObjectKey)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if stored.ID != resource.ID || stored.Provider != "aliyun" || stored.StorageSettingID == "" || stored.ETag != "content-etag" {
					t.Fatalf("resource identity/storage mismatch: %+v", stored)
				}
				parsed, err := url.Parse(media.URL)
				if err != nil || parsed.Query().Get("signature") == "" || parsed.Query().Get("expires") == "" || parsed.Path != "/api/public/resources/image-1/file" || !strings.HasPrefix(stored.ObjectKey, "9gtoken-assets/9glab/") {
					t.Fatal("expected signed public proxy and object under configured prefix")
				}
				if err := svc.hydrateProviderMedia("owner", &providerMedia{StorageKey: "resource:image-1"}, providerMediaHydrationPolicy{requireURL: true}); err != nil {
					t.Fatal(err)
				}
				if puts != 1 {
					t.Fatalf("expected one upload, got %d", puts)
				}
			}
			if err := svc.hydrateProviderMedia("other-owner", &providerMedia{StorageKey: "resource:image-1"}, providerMediaHydrationPolicy{requireURL: true}); err == nil {
				t.Fatal("another user accessed the resource")
			}
			backup, err := os.ReadFile(localPath)
			if err != nil || string(backup) != payload {
				t.Fatal("original local backup was not preserved")
			}
		})
	}
}
