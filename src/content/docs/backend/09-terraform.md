---
title: Terraform
slug: backend/terraform
sidebar:
    order: 9
---

TODO: write more complete guides

### What to do if you get a locked state:

```
% terraform plan
╷
│ Error: Error acquiring the state lock
│
│ Error message: operation error DynamoDB: PutItem, https response error StatusCode: 400, RequestID:
│ IBL35BESTVD1GQID3TRON01ADFVV4KQNSO5AEMVJF66Q9ASUAAJG, ConditionalCheckFailedException: The conditional request failed
│ Lock Info:
│   ID:        7622a128-79f1-2179-815a-d821369a815e
│   Path:      ooni-production-terraform-state/terraform.tfstate
│   Operation: OperationTypeApply
│   Who:       art@himiko.local
│   Version:   1.7.0
│   Created:   2024-02-05 11:51:45.398054 +0000 UTC
│   Info:
│
│
│ Terraform acquires a state lock to protect the state from being written
│ by multiple users at the same time. Please resolve the issue above and try
│ again. For most commands, you can disable locking with the "-lock=false"
│ flag, but this is not recommended.
```

```
% terraform force-unlock -force 7622a128-79f1-2179-815a-d821369a815e
Terraform state has been successfully unlocked!

The state has been unlocked, and Terraform commands should now be able to
obtain a new lock on the remote state.
```
